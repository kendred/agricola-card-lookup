// Screenshot OCR module for Agricola draft tool
// Handles image preprocessing, Azure Function call, and fuzzy matching.
// Uses `var` for Babel standalone compatibility.

var OCR_FUNCTION_URL = '/api/ocr';

var screenshotOCR = (function () {

    // --- Image preprocessing ---
    // Resize image to max dimension and compress as JPEG before uploading.
    function resizeImage(blob, maxDim) {
        maxDim = maxDim || 2048;
        return new Promise(function (resolve, reject) {
            var img = new Image();
            var url = URL.createObjectURL(blob);
            img.onload = function () {
                URL.revokeObjectURL(url);
                // If already small enough and is JPEG, return as-is
                if (img.width <= maxDim && img.height <= maxDim && blob.type === 'image/jpeg') {
                    resolve(blob);
                    return;
                }
                var scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
                var canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(function (resizedBlob) {
                    if (resizedBlob) {
                        resolve(resizedBlob);
                    } else {
                        reject(new Error('Failed to resize image.'));
                    }
                }, 'image/jpeg', 0.85);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image for resizing.'));
            };
            img.src = url;
        });
    }

    // --- Convert blob to base64 data URL ---
    function blobToDataURL(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onloadend = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('Failed to read image.')); };
            reader.readAsDataURL(blob);
        });
    }

    // --- Call the Azure Function ---
    function callOCRFunction(imageBlob, functionUrl) {
        return blobToDataURL(imageBlob).then(function (dataURL) {
            return fetch(functionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: dataURL }),
            });
        }).then(function (response) {
            if (response.status === 429) {
                throw new Error('Too many requests. Try again in a few minutes.');
            }
            if (!response.ok) {
                return response.json().catch(function () { return {}; }).then(function (data) {
                    if (data.error) throw new Error(data.error);
                    if (response.status === 501) throw new Error('The screenshot service is not set up yet.');
                    if (response.status === 503) throw new Error('The screenshot service is temporarily unavailable. Try again later.');
                    if (response.status >= 500) throw new Error('The screenshot service ran into a problem. Please try again.');
                    if (response.status === 400) throw new Error('Could not process the image. Try a clearer screenshot.');
                    throw new Error('Screenshot processing failed. Please try again.');
                });
            }
            return response.json();
        }).then(function (data) {
            return data.cardNames || [];
        });
    }

    // --- Levenshtein distance ---
    function levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        var matrix = [];
        for (var i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (var j = 0; j <= a.length; j++) { matrix[0][j] = j; }
        for (var i = 1; i <= b.length; i++) {
            for (var j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,      // insertion
                        matrix[i - 1][j] + 1       // deletion
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }

    // --- Fuzzy match returned names against card database ---
    // Uses normalizeForMatch (global from draft.html) and Levenshtein distance.
    function matchNames(rawNames, cards, cardMap) {
        var matched = [];
        var unmatched = [];

        // Build a lookup: normalized name -> card name
        var normalizedLookup = {};
        cards.forEach(function (card) {
            normalizedLookup[normalizeForMatch(card.name)] = card.name;
        });
        var normalizedKeys = Object.keys(normalizedLookup);

        rawNames.forEach(function (rawName) {
            if (!rawName || typeof rawName !== 'string') return;

            // 1. Exact match in cardMap (case-sensitive)
            if (cardMap[rawName]) {
                matched.push(rawName);
                return;
            }

            // 2. Normalized exact match
            var norm = normalizeForMatch(rawName);
            if (normalizedLookup[norm]) {
                matched.push(normalizedLookup[norm]);
                return;
            }

            // 3. Levenshtein fuzzy match (threshold: 25% of name length, minimum 1)
            var bestMatch = null;
            var bestDist = Infinity;
            var threshold = Math.max(1, Math.floor(norm.length * 0.25));

            for (var i = 0; i < normalizedKeys.length; i++) {
                var key = normalizedKeys[i];
                // Quick length filter — skip if lengths differ by more than threshold
                if (Math.abs(key.length - norm.length) > threshold) continue;
                var dist = levenshtein(norm, key);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestMatch = normalizedLookup[key];
                    if (dist === 0) break; // perfect match
                }
            }

            if (bestDist <= threshold && bestMatch) {
                matched.push(bestMatch);
            } else {
                unmatched.push(rawName);
            }
        });

        return { matched: matched, unmatched: unmatched };
    }

    // --- Main entry point ---
    // processImage(imageBlob, cards, cardMap, currentHandNames, allUsedCardNames, currentRound)
    // Returns: { matched, added, duplicates, unmatched, skippedOverflow, total }
    function processImage(imageBlob, cards, cardMap, currentHandNames, allUsedCardNames, currentRound) {
        var HAND_SIZE = { 1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4 };

        return resizeImage(imageBlob, 2048).then(function (resizedBlob) {
            return callOCRFunction(resizedBlob, OCR_FUNCTION_URL);
        }).then(function (rawNames) {
            // Match against card database
            var result = matchNames(rawNames, cards, cardMap);
            var total = rawNames.length;

            // Categorize matched cards
            var added = [];
            var duplicates = [];
            var skippedOverflow = [];
            var limit = HAND_SIZE[currentRound] || 10;

            // Count current cards by type for overflow checking
            var currentTypeCounts = {};
            currentHandNames.forEach(function (name) {
                var card = cardMap[name];
                if (card) {
                    currentTypeCounts[card.type] = (currentTypeCounts[card.type] || 0) + 1;
                }
            });

            result.matched.forEach(function (name) {
                // Already in current hand?
                if (currentHandNames.includes(name)) {
                    duplicates.push(name);
                    return;
                }

                // Already used in a prior round?
                if (allUsedCardNames && allUsedCardNames.has(name)) {
                    duplicates.push(name);
                    return;
                }

                // Would exceed type limit?
                var card = cardMap[name];
                if (card) {
                    var typeCount = currentTypeCounts[card.type] || 0;
                    if (typeCount >= limit) {
                        skippedOverflow.push(name);
                        return;
                    }
                    // Track the addition for subsequent overflow checks
                    currentTypeCounts[card.type] = typeCount + 1;
                }

                added.push(name);
            });

            return {
                matched: added, // only the ones that will actually be added
                added: added,
                duplicates: duplicates,
                unmatched: result.unmatched,
                skippedOverflow: skippedOverflow,
                total: total,
            };
        });
    }

    // --- Check if the OCR endpoint is reachable ---
    // Returns a Promise<boolean>. Sends an OPTIONS preflight or a tiny POST
    // that the function will reject (400) but proves the server is up.
    function checkAvailability() {
        return fetch(OCR_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
            .then(function (response) {
                // Any response (even 400/500) means the server is reachable
                return true;
            })
            .catch(function () {
                return false;
            });
    }

    return {
        processImage: processImage,
        matchNames: matchNames,
        resizeImage: resizeImage,
        checkAvailability: checkAvailability,
        // Exposed for testing:
        _levenshtein: levenshtein,
        _callOCRFunction: callOCRFunction,
    };

})();
