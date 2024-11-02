const uniqueId = window.location.pathname.slice(1).replaceAll('\/', '_'); // Skip the first slash and replace all the remaining slashes.
const storageKey = `highlights/${uniqueId}`; // Namespace by document path
const scrollPositionKey = `scrollPosition_${uniqueId}`;

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
    document.querySelector('#mark-button').addEventListener('touchstart', (event) => {                                                                                                        
        event.preventDefault();
        markSelection();                                                                                                                                                                          
    });
    document.querySelector('#unmark-button').addEventListener('touchstart', (event) => {
        event.preventDefault();
        unmarkSelection();
    });
});

// Save scroll position when the page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        localStorage.setItem(scrollPositionKey, window.scrollY);
    }
});

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
function markSelection() {
    console.log('Highlighting selection');
    let selection = window.getSelection();
    if (selection.rangeCount > 0) {
        let range = selection.getRangeAt(0);
        // To avoid nested or overlapping highlights, check if the selected range is single node
        if (range.startContainer !== range.endContainer || range.startContainer.nodeType != Node.TEXT_NODE) {
            alert('Overlapping or nested highlights are not allowed.');
            return;
        }
        // Check if the selected range is already highlighted
        if (isHighlightSpan(range.startContainer.parentElement)) {
            alert('Selected text is already highlighted.');
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

function unmarkSelection() {
    let selection = window.getSelection();
    if (selection.rangeCount > 0) {
        let range = selection.getRangeAt(0);
        // NOTE: In Mobile Chrome, when you select text, it goes to the endContainer, and the startContainer
        // points to the previous text, with the startOffset at the end of the previous text.
        // If there is no previous text, startContainer === endContainer.
        if (!isHighlightSpan(range.endContainer.parentElement)) {
            alert(`Selected text is not highlighted: "${range.toString()}"`);
            return;
        }
        let span = range.endContainer.parentElement;
        if (range.startContainer !== range.endContainer) {
            let start = range.startContainer;
            if (start.nodeType !== Node.TEXT_NODE || start.textContent.length !== range.startOffset) {
                alert(`Selected wrong range: "${range.toString()}"`);
                return;
            }
        }
        let parent = span.parentElement;
        if (!isParagraph(parent)) {
            alert(`Unexpected parent: "${parent.outerHTML}"`);
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
        let range = document.createRange();
        range.selectNodeContents(span);
        return span.textContent;
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
            let highlightTexts;
            if (err) {
                console.log('No highlights data in S3:', err);
                highlightTexts = JSON.parse(localStorage.getItem(storageKey) || '[]');
            } else {
                console.log('Highlights data loaded from S3');
                highlightTexts = JSON.parse(data.Body.toString());
            }
            applyHighlightTexts(highlightTexts);
        });
    } else {
        // Load from local storage if S3 is not used
        let highlightTexts = JSON.parse(localStorage.getItem(storageKey) || '[]');
        applyHighlightTexts(highlightTexts);
    }
}

function applyHighlightTexts(highlightTexts) {
    highlightTexts.forEach(text => {
        let content = document.body.innerHTML;
        let highlightedContent = content.replace(new RegExp(`(${text})`, 'g'), '<span class="highlight">$1</span>');
        document.body.innerHTML = highlightedContent;
    });
    saveHighlights();
}

function exportMarkedText() {
    let highlights = document.querySelectorAll('.highlight');
    if (highlights.length === 0) {
        alert('No highlighted text to export.');
        return;
    }

    let extractedText = ''
    for (let i = 0; i < highlights.length; i++) {
        // Replace <br> with newline
        extractedText += highlights[i].innerHTML.replace(/<br>/g, '\n') + '\n';
    }

    // Create a Blob from the bulleted list
    let blob = new Blob([extractedText], { type: 'text/plain' });
    let link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = 'highlighted_text.txt';

    // Trigger the download
    link.click();
}
