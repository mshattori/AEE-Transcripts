const uniqueId = window.location.pathname.slice(1) // Skip the first slash
const storageKey = `${uniqueId}/highlights`; // Namespace by document path
const scrollPositionKey = `${uniqueId}/scroll-position`;
const scrollPercentageKey = `${uniqueId}/scroll-percentage`;

let useS3Storage = false;
let bucketName = '';
let highlightRegistry = null;
let savedRanges = []; // Store ranges for persistence

// Check if CSS Custom Highlight API is supported
const supportsCustomHighlight = typeof CSS !== 'undefined' && CSS.highlights;

// Load saved highlights and scroll position on document load
document.addEventListener('DOMContentLoaded', () => {
    bucketName = localStorage.getItem('aws_bucket_name');

    const accessKey = localStorage.getItem('aws_access_key');
    const secretKey = localStorage.getItem('aws_secret_key');
    const region = localStorage.getItem('aws_region');

    if (bucketName && accessKey && secretKey && region) {
        useS3Storage = true;
        AWS.config.update({
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
            region: region // Use the specified region
        });
    }

    // Initialize highlight system
    initializeHighlights();
    loadHighlights();

    const savedScrollPosition = localStorage.getItem(scrollPositionKey);
    if (savedScrollPosition) {
        window.scrollTo(0, parseInt(savedScrollPosition, 10));
    }
    bindButtonListeners();
});

function initializeHighlights() {
    if (supportsCustomHighlight) {
        highlightRegistry = new Highlight();
        CSS.highlights.set('text-highlights', highlightRegistry);
    }
    savedRanges = [];
}

function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

let lastTouchTime = 0;

function bindButtonListeners() {
    const markButton = document.querySelector('#mark-button');
    const unmarkButton = document.querySelector('#unmark-button');

    if (!markButton || !unmarkButton) {
        return;
    }

    markButton.removeEventListener('click', onMarkSelection);
    markButton.removeEventListener('touchstart', onMarkSelection);
    unmarkButton.removeEventListener('click', onUnmarkSelection);
    unmarkButton.removeEventListener('touchstart', onUnmarkSelection);

    markButton.addEventListener('click', onMarkSelection);
    unmarkButton.addEventListener('click', onUnmarkSelection);

    if (isTouchDevice()) {
        markButton.addEventListener('touchstart', onMarkSelection, { passive: false });
        unmarkButton.addEventListener('touchstart', onUnmarkSelection, { passive: false });
    }
}

// Save scroll position when the page is hidden
document.addEventListener('visibilitychange', () => {
    const visibilityState = document.visibilityState;

    console.log('visibilitychange', visibilityState)

    switch (visibilityState) {
        case 'hidden':
            savePosition();
            break;
        case 'visible':
            bindButtonListeners();
            break;
    }
});
document.addEventListener('pagehide', (event) => {
    if (event.persisted) {
        savePosition();
    }
});
document.addEventListener('beforeunload', (event) => {
    savePosition();
});

function savePosition() {
    localStorage.setItem(scrollPositionKey, window.scrollY);
    // Save the scroll percentage
    let scrollTop = window.scrollY || document.documentElement.scrollTop;
    let docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    let scrolled = (scrollTop / docHeight) * 100;
    localStorage.setItem(scrollPercentageKey, scrolled.toFixed(0));
}

// Function to handle the highlighting process
function onMarkSelection(event) {
    // Prevent duplicate events (touch triggers a synthetic click on some devices)
    if (shouldIgnoreClick(event)) {
        return;
    }
    updateLastTouchTime(event);
    event.preventDefault();
    console.log(`Highlighting selection: ${event.type}`);
    let selection = window.getSelection();
    if (selection.rangeCount > 0) {
        let range = selection.getRangeAt(0);
        
        // Check if range is valid and not empty
        if (range.collapsed) {
            showAlert('No text selected.');
            return;
        }

        // Trim the range to remove leading/trailing whitespace
        range = trimRange(range);
        if (!range) {
            showAlert('No valid text selected.');
            return;
        }

        // Check for overlaps with existing highlights
        if (hasOverlappingHighlight(range)) {
            showAlert('Overlapping highlights are not allowed.');
            return;
        }

        // Add highlight using CSS Custom Highlight API or fallback
        if (supportsCustomHighlight) {
            addHighlightWithAPI(range);
        } else {
            addHighlightWithSpan(range);
        }

        saveHighlights();
        selection.removeAllRanges(); // Clear selection
    } else {
        showAlert('No text selected.');
    }
}

function addHighlightWithAPI(range) {
    // Extract text before creating StaticRange (StaticRange.toString() doesn't work)
    const text = range.toString();
    
    // Create a StaticRange for persistence
    const staticRange = new StaticRange({
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset
    });

    // Add to highlight registry
    highlightRegistry.add(staticRange);
    
    // Store range data for persistence (pass the extracted text)
    const rangeData = serializeRange(range, text);
    savedRanges.push(rangeData);
}

function addHighlightWithSpan(range) {
    // Fallback for browsers without CSS Custom Highlight API support
    try {
        let span = document.createElement('span');
        span.className = 'highlight';
        range.surroundContents(span);
        
        // Store range data for persistence
        const rangeData = serializeRangeFromSpan(span);
        savedRanges.push(rangeData);
    } catch (error) {
        console.error('Failed to add highlight with span:', error);
        showAlert('Failed to highlight selected text.');
    }
}

function trimRange(range) {
    let selectedText = range.toString().trim();
    if (selectedText.length === 0) {
        return null;
    }
    if (selectedText === range.toString()) {
        return range; // No trimming needed
    }

    // Find the trimmed text position within the original range
    const originalText = range.toString();
    const startTrimOffset = originalText.indexOf(selectedText);
    const endTrimOffset = startTrimOffset + selectedText.length;

    // Create new range with adjusted offsets
    let newRange = document.createRange();
    newRange.setStart(range.startContainer, range.startOffset + startTrimOffset);
    newRange.setEnd(range.startContainer, range.startOffset + endTrimOffset);

    return newRange;
}

function hasOverlappingHighlight(newRange) {
    // Check if new range overlaps with existing highlights
    for (const rangeData of savedRanges) {
        const existingRange = deserializeRange(rangeData);
        if (existingRange && rangesOverlap(newRange, existingRange)) {
            return true;
        }
    }
    return false;
}

function rangesOverlap(range1, range2) {
    // Simple overlap detection
    const comparison = range1.compareBoundaryPoints(Range.START_TO_END, range2);
    const comparison2 = range1.compareBoundaryPoints(Range.END_TO_START, range2);
    return comparison > 0 && comparison2 < 0;
}

function onUnmarkSelection(event) {
    // Prevent duplicate events (touch triggers a synthetic click on some devices)
    if (shouldIgnoreClick(event)) {
        return;
    }
    updateLastTouchTime(event);
    event.preventDefault();
    let selection = window.getSelection();
    if (selection.rangeCount > 0) {
        let range = selection.getRangeAt(0);
        
        // Find overlapping highlight to remove
        const highlightToRemove = findOverlappingHighlight(range);
        
        if (highlightToRemove) {
            if (supportsCustomHighlight) {
                removeHighlightWithAPI(highlightToRemove);
            } else {
                removeHighlightWithSpan(range);
            }
            saveHighlights();
        } else {
            showAlert('Selected text is not highlighted.');
        }
    }
}

function updateLastTouchTime(event) {
    if (event.type.startsWith('touch') || event.pointerType === 'touch') {
        lastTouchTime = Date.now();
    }
}

function shouldIgnoreClick(event) {
    if (event.type !== 'click') {
        return false;
    }
    return lastTouchTime !== 0 && Date.now() - lastTouchTime < 500;
}

function findOverlappingHighlight(range) {
    for (let i = 0; i < savedRanges.length; i++) {
        const rangeData = savedRanges[i];
        const existingRange = deserializeRange(rangeData);
        if (existingRange && rangesOverlap(range, existingRange)) {
            return { index: i, rangeData, range: existingRange };
        }
    }
    return null;
}

function removeHighlightWithAPI(highlightInfo) {
    // Remove from saved ranges
    savedRanges.splice(highlightInfo.index, 1);
    
    // Rebuild the highlight registry from remaining saved ranges
    // (Highlight.delete() requires the exact same object instance that was added,
    // but we only have serialized data, so we must clear and rebuild)
    rebuildHighlightRegistry();
}

function rebuildHighlightRegistry() {
    // Clear and rebuild the highlight registry from savedRanges
    highlightRegistry.clear();
    
    for (const rangeData of savedRanges) {
        const range = deserializeRange(rangeData);
        if (range) {
            const staticRange = new StaticRange({
                startContainer: range.startContainer,
                startOffset: range.startOffset,
                endContainer: range.endContainer,
                endOffset: range.endOffset
            });
            highlightRegistry.add(staticRange);
        }
    }
}

function removeHighlightWithSpan(range) {
    // Find and remove span elements (fallback method)
    const spans = document.querySelectorAll('.highlight');
    for (const span of spans) {
        if (span.contains(range.startContainer) || span.contains(range.endContainer)) {
            // Remove highlight class and unwrap content
            const parent = span.parentElement;
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
            
            // Remove from saved ranges
            const rangeData = serializeRangeFromSpan(span);
            const index = savedRanges.findIndex(r => 
                r.startContainerSelector === rangeData.startContainerSelector &&
                r.startOffset === rangeData.startOffset &&
                r.text === rangeData.text
            );
            if (index !== -1) {
                savedRanges.splice(index, 1);
            }
            break;
        }
    }
}

function serializeRange(range, text) {
    // Convert range to serializable format using element IDs
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    // Find the closest element with an ID (supports p, li, and other elements)
    const startElement = findContainerWithId(startContainer);
    const endElement = findContainerWithId(endContainer);

    // If no container with ID found, the highlight cannot be persisted
    if (!startElement || !endElement) {
        console.warn('Cannot persist highlight: no container with ID found');
        return {
            startContainerSelector: null,
            startOffset: 0,
            endContainerSelector: null,
            endOffset: 0,
            text: text
        };
    }

    return {
        startContainerSelector: `#${startElement.id}`,
        startOffset: getTextOffsetInElement(startContainer, range.startOffset, startElement),
        endContainerSelector: `#${endElement.id}`,
        endOffset: getTextOffsetInElement(endContainer, range.endOffset, endElement),
        text: text
    };
}

function findContainerWithId(node) {
    // Find the closest element with an ID attribute
    const element = node.nodeType === Node.TEXT_NODE 
        ? node.parentElement 
        : node;
    
    // First try to find a paragraph or list item with an ID
    const container = element.closest('p[id], li[id]');
    if (container) return container;
    
    // Fallback to any element with an ID
    return element.closest('[id]');
}

function serializeRangeFromSpan(span) {
    // Serialize range data from existing highlight span
    const container = findContainerWithId(span);
    const textOffset = getTextOffsetInElement(span.firstChild, 0, container);
    
    return {
        startContainerSelector: container ? `#${container.id}` : null,
        startOffset: textOffset,
        endContainerSelector: container ? `#${container.id}` : null,
        endOffset: textOffset + span.textContent.length,
        text: span.textContent
    };
}

function getTextOffsetInElement(node, offset, element) {
    if (!element) return 0;
    
    let textOffset = 0;
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let currentNode;
    while (currentNode = walker.nextNode()) {
        if (currentNode === node || (node.nodeType === Node.ELEMENT_NODE && node.contains(currentNode))) {
            return textOffset + offset;
        }
        textOffset += currentNode.textContent.length;
    }
    return textOffset;
}

function deserializeRange(rangeData) {
    // Convert serialized range data back to Range object
    if (!rangeData.startContainerSelector) return null;
    
    const startParagraph = document.querySelector(rangeData.startContainerSelector);
    const endParagraph = document.querySelector(rangeData.endContainerSelector);
    
    if (!startParagraph || !endParagraph) return null;
    
    const startNode = getTextNodeAtOffset(startParagraph, rangeData.startOffset);
    const endNode = getTextNodeAtOffset(endParagraph, rangeData.endOffset);
    
    if (!startNode || !endNode) return null;
    
    try {
        const range = document.createRange();
        range.setStart(startNode.node, startNode.offset);
        range.setEnd(endNode.node, endNode.offset);
        return range;
    } catch (error) {
        console.error('Failed to deserialize range:', error);
        return null;
    }
}

function getTextNodeAtOffset(paragraph, targetOffset) {
    let currentOffset = 0;
    const walker = document.createTreeWalker(
        paragraph,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let node;
    while (node = walker.nextNode()) {
        const nodeLength = node.textContent.length;
        if (currentOffset + nodeLength >= targetOffset) {
            return {
                node: node,
                offset: targetOffset - currentOffset
            };
        }
        currentOffset += nodeLength;
    }
    return null;
}

// Function to save highlights to local storage and S3
function saveHighlights() {
    const highlightData = savedRanges.map(rangeData => ({
        text: rangeData.text,
        startContainerSelector: rangeData.startContainerSelector,
        startOffset: rangeData.startOffset,
        endContainerSelector: rangeData.endContainerSelector,
        endOffset: rangeData.endOffset
    }));

    // Save highlights to local storage
    localStorage.setItem(storageKey, JSON.stringify(highlightData));

    // If using S3 storage, upload the highlights to S3
    if (useS3Storage) {
        const params = {
            Bucket: bucketName,
            Key: `${storageKey}.json`,
            Body: JSON.stringify(highlightData),
            ContentType: 'application/json'
        };

        const s3 = new AWS.S3();
        s3.putObject(params, (err, data) => {
            if (err) {
                console.error('Error uploading highlights to S3:', err);
            } else {
                console.log('Highlights successfully uploaded to S3:', data);
            }
        });
    }
}

// Load highlights from local storage or S3
function loadHighlights() {
    if (useS3Storage) {
        const params = {
            Bucket: bucketName,
            Key: `${storageKey}.json`
        };
        const s3 = new AWS.S3();
        s3.getObject(params, (err, data) => {
            let highlightRecords;
            if (err) {
                console.log('No highlights data in S3:', err);
                highlightRecords = JSON.parse(localStorage.getItem(storageKey) || '[]');
            } else {
                console.log('Highlights data loaded from S3');
                highlightRecords = JSON.parse(data.Body.toString());
            }
            applyHighlights(highlightRecords);
        });
    } else {
        let highlightRecords = JSON.parse(localStorage.getItem(storageKey) || '[]');
        applyHighlights(highlightRecords);
    }
}

function applyHighlights(records) {
    // Clear existing highlights
    savedRanges = [];
    if (supportsCustomHighlight) {
        highlightRegistry.clear();
    }

    records.forEach(record => {
        const range = deserializeRange(record);
        if (range) {
            if (supportsCustomHighlight) {
                const staticRange = new StaticRange({
                    startContainer: range.startContainer,
                    startOffset: range.startOffset,
                    endContainer: range.endContainer,
                    endOffset: range.endOffset
                });
                highlightRegistry.add(staticRange);
            } else {
                // Fallback: create span elements
                try {
                    const span = document.createElement('span');
                    span.className = 'highlight';
                    range.surroundContents(span);
                } catch (error) {
                    console.error('Failed to apply highlight:', error);
                }
            }
            savedRanges.push(record);
        }
    });
}

function exportMarkedText() {
    const title = document.title.replace(/ /g, '_');
    const highlights = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (highlights.length === 0) {
        showAlert('No highlighted text to export.');
        return;
    }

    let extractedText = '';
    for (let i = 0; i < highlights.length; i++) {
        const record = highlights[i];
        const highlightedText = record.text.replace(/<br>/g, '\n');
        
        // Get full paragraph text
        const paragraph = document.querySelector(record.startContainerSelector);
        if (paragraph) {
            let paragraphText = paragraph.textContent;
            const beforeText = paragraphText.slice(0, record.startOffset);
            const afterText = paragraphText.slice(record.endOffset);
            
            paragraphText = beforeText + `**${highlightedText}**` + afterText;
            paragraphText = paragraphText.replace(/<br>/g, '\n');
            
            extractedText += `Text: ${record.text}\n`;
            extractedText += `Paragraph: ${paragraphText}\n\n`;
        } else {
            extractedText += `Text: ${record.text}\n\n`;
        }
    }

    // Create a Blob from the extracted text
    let blob = new Blob([extractedText], { type: 'text/plain' });
    let link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = `${title}.txt`; 

    // Trigger the download
    link.click();
}

// Show UiKit notification
// type: primary, success, warning, danger
function showAlert(message, type = 'danger') {
    UIkit.notification({
        message: message,
        status: type,
        pos: 'top-center',
        timeout: 7000
    });
}
