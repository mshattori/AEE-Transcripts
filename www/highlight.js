const uniqueId = window.location.pathname.slice(1) // Skip the first slash
const storageKey = `${uniqueId}/highlights`; // Namespace by document path
const scrollPositionKey = `${uniqueId}/scroll-position`;
const scrollPercentageKey = `${uniqueId}/scroll-percentage`;

let useS3Storage = false;
let bucketName = '';

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
    loadHighlights();

    const savedScrollPosition = localStorage.getItem(scrollPositionKey);
    if (savedScrollPosition) {
        window.scrollTo(0, parseInt(savedScrollPosition, 10));
    }
    const markButton = document.querySelector('#mark-button');
    const unmarkButton = document.querySelector('#unmark-button');

    if (isTouchDevice()) {
        markButton.addEventListener('touchstart', onMarkSelection);
        unmarkButton.addEventListener('touchstart', onUnmarkSelection);
    } else {
        markButton.addEventListener('click', onMarkSelection);
        unmarkButton.addEventListener('click', onUnmarkSelection);
    }
});

function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
} 

function resetTouchEventListeners() {
    const markButton = document.querySelector('#mark-button');
    const unmarkButton = document.querySelector('#unmark-button');

    markButton?.removeEventListener('touchstart', onMarkSelection);
    markButton?.addEventListener('touchstart', onMarkSelection);
    
    unmarkButton?.removeEventListener('touchstart', onUnmarkSelection);
    unmarkButton?.addEventListener('touchstart', onUnmarkSelection);
};

// Save scroll position when the page is hidden
document.addEventListener('visibilitychange', () => {
    const visibilityState = document.visibilityState;

    console.log('visibilitychange', visibilityState)

    switch (visibilityState) {
        case 'hidden':
            savePosition();
            break;
        case 'visible':
            resetTouchEventListeners();
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

function isSpan(node) {
    return (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'span');
}

function isHighlightSpan(node) {
    return (isSpan(node) && node.classList.contains('highlight'));
}

function isParagraph(node) {
    return (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'p');
}

// Function to handle the highlighting process
function onMarkSelection(event) {
    event.preventDefault(); // Prevent the default action
    console.log(`Highlighting selection: ${event.type}`); ;
    let selection = window.getSelection();
    if (selection.rangeCount > 0) {
        let range = selection.getRangeAt(0);
        // To avoid nested or overlapping highlights, check if the selected range is single node
        if (range.startContainer !== range.endContainer || range.startContainer.nodeType != Node.TEXT_NODE) {
            showAlert('Overlapping or nested highlights are not allowed.');
            return;
        }
        // Check if the selected range is already highlighted
        if (isHighlightSpan(range.startContainer.parentElement)) {
            showAlert('Selected text is already highlighted.');
            return;
        }
        range = trimRange(range); // Trim the range
        if (range) {
            // Create a new span element
            let span = document.createElement('span');
            span.className = 'highlight';
            // Surround the trimmed range with the span
            range.surroundContents(span);
            saveHighlights();
        }
    } else {
        showAlert('No text selected.');
    }
}

function trimRange(range) {
    let selectedText = range.toString().trim(); // Trim whitespace from the selected text
    if (selectedText.length === 0) {
        return null;
    }
    if (selectedText === range.toString()) {
        return range; // No trimming needed
    }
    // Create new offsets
    let startOffset = range.startOffset;
    let endOffset = range.endOffset;

    // Adjust the range to reflect the trimmed text
    if (startOffset > 0) {
        startOffset = range.startContainer.textContent.indexOf(selectedText);
    }
    if (endOffset < range.endContainer.textContent.length) {
        endOffset = startOffset + selectedText.length;
    }

    // Create a new range with the adjusted offsets
    let newRange = document.createRange();
    newRange.setStart(range.startContainer, startOffset);
    newRange.setEnd(range.endContainer, endOffset);

    return newRange;
}

function onUnmarkSelection(event) {
    event.preventDefault();
    let selection = window.getSelection();
    if (selection.rangeCount > 0) {
        let range = selection.getRangeAt(0);
        // NOTE: In Mobile Chrome, when you select text, it goes to the endContainer, and the startContainer
        // points to the previous text, with the startOffset at the end of the previous text.
        // If there is no previous text, startContainer === endContainer.
        if (!isHighlightSpan(range.endContainer.parentElement)) {
            showAlert(`Selected text is not highlighted: "${range.toString()}"`);
            return;
        }
        let span = range.endContainer.parentElement;
        if (range.startContainer !== range.endContainer) {
            let start = range.startContainer;
            if (start.nodeType !== Node.TEXT_NODE || start.textContent.length !== range.startOffset) {
                showAlert(`Selected wrong range: "${range.toString()}"`);
                return;
            }
        }
        let parent = span.parentElement;
        if (!isParagraph(parent)) {
            showAlert(`Unexpected parent: "${parent.outerHTML}"`);
            return;
        }
        span.classList.remove('highlight');

        // Remove spans with empty classess
        content = parent.innerHTML
        newContent = content.replace(/<span class="">(.*?)<\/span>/g, '$1');
        parent.innerHTML = newContent;

        // let newContent = document.createDocumentFragment();
        // let previousNode = null;

        // children.forEach(child => {
        //     if (isSpan(child) && child.classList.length === 0) {
        //         // If the child is an empty span, merge its first text with the previous text node
        //         firstIndex = 0
        //         if (child.firstChild.nodeType === Node.TEXT_NODE) {
        //             if (previousNode && previousNode.nodeType === Node.TEXT_NODE) {
        //                 previousNode.textContent += child.firstChild.textContent;
        //                 previousNode = child.firstChild;
        //                 firstIndex = 1;
        //             }
        //         }
        //         for (let i = firstIndex; i < child.childNodes.length; i++) {
        //             newContent.appendChild(child.childNodes[i]);
        //             previousNode = child.childNodes[i];
        //         }
        //     } else if (child.nodeType === Node.TEXT_NODE) {
        //         // If the child is a text node, merge it with the previous text node if possible
        //         if (previousNode && previousNode.nodeType === Node.TEXT_NODE) {
        //             previousNode.textContent += child.textContent;
        //         } else {
        //             newContent.appendChild(child);
        //             previousNode = child;
        //         }
        //     } else {
        //         // Otherwise, just append the node
        //         newContent.appendChild(child);
        //         previousNode = child;
        //     }
        // });

        // while (grandParent.firstChild) {
        //     grandParent.removeChild(grandParent.firstChild);
        // }
        // grandParent.appendChild(newContent);

        saveHighlights();
    }
}

// Function to save highlights to local storage and S3
function saveHighlights() {
    let highlights = document.querySelectorAll('.highlight');
    let highlightData = Array.from(highlights).map(span => {
        return {
            text: span.textContent,
            paragraph: span.closest('p').textContent,
            offset: calculateTextOffset(span)
        };
    });

    // Save highlights to local storage
    localStorage.setItem(storageKey, JSON.stringify(highlightData));

    // If using S3 storage, upload the highlights to S3
    if (useS3Storage) {
        const params = {
            Bucket: bucketName,
            Key: `${storageKey}.json`, // Use the same storageKey with .json extension
            Body: JSON.stringify(highlightData),
            ContentType: 'application/json'
        };

        // Upload to S3
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

function getTextNodesBefore(elem) {
    let nodes = [];
    let walker = document.createTreeWalker(
        elem.parentElement,     // root element
        NodeFilter.SHOW_TEXT,   // text node
        null,   // optional filter
        false   // entity reference expansion
    );

    let node;
    while ((node = walker.nextNode())) {
        if (node === elem || elem.contains(node)) {
            break;
        }
        nodes.push(node);
    }
    return nodes;
}

function calculateTextOffset(elem) {
    let previousNodes = getTextNodesBefore(elem);
    let textBefore = previousNodes.map(node => node.textContent).join('');

    return textBefore.length;
}

// Load highlights from local storage or S3
function loadHighlights() {
    // Check if using S3 storage and if the bucket name is set
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
        // Load from local storage if S3 is not used
        let highlightRecords = JSON.parse(localStorage.getItem(storageKey) || '[]');
        applyHighlights(highlightRecords);
    }
}

function applyHighlights(records) {
    const paragraphs = document.querySelectorAll('p');

    records.forEach(record => {
        const { paragraph, text: targetText, offset: targetOffset } = record;

        for (const p of paragraphs) {
            if (p.textContent !== paragraph) continue;

            let walker = document.createTreeWalker(
                p,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            let currentOffset = 0;
            let node;

            // Traverse text nodes until we find the correct position
            while (node = walker.nextNode()) {
                const nodeText = node.textContent;
                const nodeLength = nodeText.length;

                // Check if the highlight position is within this text node
                if (currentOffset <= targetOffset && targetOffset < currentOffset + nodeLength) {
                    // Skip if this text is already highlighted
                    if (isHighlightSpan(node.parentElement)) {
                        break; // Useless to continue
                    }
                    let relativeOffset = targetOffset - currentOffset;
                    if (nodeText.substring(relativeOffset, relativeOffset + targetText.length) !== targetText) {
                        console.error(`Text mismatch: text="${targetText}", offset=${targetOffset}, paragraph="${paragraph}"`);
                        break; // Useless to continue
                    }
                    // Create a range for the text to highlight
                    let range = document.createRange();
                    range.setStart(node, relativeOffset);
                    range.setEnd(node, relativeOffset + targetText.length);
                    // Create and apply the highlight span
                    let span = document.createElement('span');
                    span.className = 'highlight';

                    try {
                        range.surroundContents(span);
                        break; // Successfully applied highlight
                    } catch (e) {
                        console.error('Failed to apply highlight:', e);
                    }
                }
                currentOffset += nodeText.length;
            }
        }
    });
    saveHighlights();
}

function exportMarkedText() {
    const title = document.title.replace(/ /g, '_');
    const highlights = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (highlights.length === 0) {
        showAlert('No highlighted text to export.');
        return;
    }

    let extractedText = ''
    for (let i = 0; i < highlights.length; i++) {
        const record = highlights[i];
        highlightedText = record.text.replace(/<br>/g, '\n');
        paragraphText = record.paragraph.slice(0, record.offset)
        paragraphText += `**${highlightedText}**`
        paragraphText += record.paragraph.slice(record.offset + record.text.length)
        paragraphText = paragraphText.replace(/<br>/g, '\n');
        extractedText += `Text: ${record.text}\n`
        extractedText += `Paragraph: ${paragraphText}\n\n`;
    }

    // Create a Blob from the bulleted list
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