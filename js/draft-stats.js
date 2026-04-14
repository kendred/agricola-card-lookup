// Draft statistics module for Agricola draft tool
// Computes hand grades, per-card quality indicators, and tag probability distributions.
// All math is analytical (order statistics, hypergeometric distribution) — no simulation.
// Uses `var` for Babel standalone compatibility.

var draftStats = (function () {

    // --- State (populated by init()) ---
    var occRanks = [];      // Global ranks of all Occupations, sorted ascending
    var minorRanks = [];    // Global ranks of all Minor Improvements, sorted ascending
    var occMean = 0;        // Mean global rank of Occupations
    var occVar = 0;         // Variance of Occupation global ranks
    var minorMean = 0;
    var minorVar = 0;
    var tagCounts = {};     // { tagName: { occ: N, minor: N } }
    var initialized = false;

    // --- Initialization (call once after card data loads) ---
    function init(cards) {
        if (!cards || cards.length === 0) return;

        var occs = [];
        var minors = [];
        tagCounts = {};

        cards.forEach(function (card) {
            if (typeof card.rank !== 'number' || !isFinite(card.rank)) return;
            if (card.type === 'Occupation') {
                occs.push(card.rank);
            } else if (card.type === 'Minor Improvement') {
                minors.push(card.rank);
            }
            // Count tags
            if (card.tags && card.tags.length > 0) {
                card.tags.forEach(function (tag) {
                    if (!tagCounts[tag]) tagCounts[tag] = { occ: 0, minor: 0 };
                    if (card.type === 'Occupation') tagCounts[tag].occ++;
                    else if (card.type === 'Minor Improvement') tagCounts[tag].minor++;
                });
            }
        });

        occs.sort(function (a, b) { return a - b; });
        minors.sort(function (a, b) { return a - b; });
        occRanks = occs;
        minorRanks = minors;

        // Population statistics
        occMean = mean(occs);
        occVar = variance(occs, occMean);
        minorMean = mean(minors);
        minorVar = variance(minors, minorMean);

        initialized = true;
    }

    function mean(arr) {
        if (arr.length === 0) return 0;
        var sum = 0;
        for (var i = 0; i < arr.length; i++) sum += arr[i];
        return sum / arr.length;
    }

    function variance(arr, mu) {
        if (arr.length === 0) return 0;
        var sum = 0;
        for (var i = 0; i < arr.length; i++) {
            var d = arr[i] - mu;
            sum += d * d;
        }
        return sum / arr.length;
    }

    // --- Normal CDF approximation (Abramowitz & Stegun) ---
    function normalCDF(z) {
        if (z < -8) return 0;
        if (z > 8) return 1;
        var negative = z < 0;
        if (negative) z = -z;
        var t = 1 / (1 + 0.2316419 * z);
        var d = 0.3989422804014327; // 1/sqrt(2*pi)
        var p = d * Math.exp(-z * z / 2);
        var poly = ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530) * t;
        var cdf = 1 - p * poly;
        return negative ? 1 - cdf : cdf;
    }

    // --- Expected rank of the k-th best card (1-indexed) in a hand of n from a pool ---
    // Interpolates into the sorted rank array for the actual global rank.
    function expectedKthRank(k, n, rankArray) {
        var N = rankArray.length;
        if (N === 0 || n === 0 || k < 1 || k > n) return null;
        // Expected position (0-indexed) in the sorted array
        var pos = k * (N + 1) / (n + 1) - 1; // convert to 0-indexed
        if (pos < 0) pos = 0;
        if (pos >= N - 1) return rankArray[N - 1];
        // Linear interpolation
        var low = Math.floor(pos);
        var frac = pos - low;
        return rankArray[low] * (1 - frac) + rankArray[low + 1] * frac;
    }

    // --- Hand percentile ---
    // Lower sum of ranks = better hand. Returns percentile (0-100, higher = better).
    function handPercentile(handCards) {
        if (!initialized) return null;
        var occCards = [];
        var minorCards = [];
        handCards.forEach(function (card) {
            if (typeof card.rank !== 'number' || !isFinite(card.rank)) return;
            if (card.type === 'Occupation') occCards.push(card.rank);
            else if (card.type === 'Minor Improvement') minorCards.push(card.rank);
        });

        if (occCards.length === 0 && minorCards.length === 0) return null;

        // Expected sum and variance for each type
        var expectedSum = 0;
        var totalVar = 0;

        if (occCards.length > 0) {
            var nOcc = occCards.length;
            var NOcc = occRanks.length;
            expectedSum += nOcc * occMean;
            // Finite-population correction: n * sigma^2 * (N-n)/(N-1)
            totalVar += nOcc * occVar * (NOcc - nOcc) / (NOcc - 1);
        }
        if (minorCards.length > 0) {
            var nMin = minorCards.length;
            var NMin = minorRanks.length;
            expectedSum += nMin * minorMean;
            totalVar += nMin * minorVar * (NMin - nMin) / (NMin - 1);
        }

        var actualSum = 0;
        occCards.forEach(function (r) { actualSum += r; });
        minorCards.forEach(function (r) { actualSum += r; });

        if (totalVar === 0) return 50;
        var z = (actualSum - expectedSum) / Math.sqrt(totalVar);
        // Lower sum = better hand. P(random hand has higher sum) = 1 - normalCDF(z).
        // So a great hand (very negative z) gets percentile near 100.
        return Math.round((1 - normalCDF(z)) * 100);
    }

    // --- Hand grade from percentile ---
    function handGrade(percentile) {
        if (percentile === null) return { grade: '—', color: '#888' };
        if (percentile >= 95) return { grade: 'A+', color: '#1a7a1a' };
        if (percentile >= 85) return { grade: 'A', color: '#28a745' };
        if (percentile >= 70) return { grade: 'B+', color: '#5cb85c' };
        if (percentile >= 55) return { grade: 'B', color: '#8B6914' };
        if (percentile >= 40) return { grade: 'C+', color: '#d4a017' };
        if (percentile >= 25) return { grade: 'C', color: '#e67e22' };
        if (percentile >= 10) return { grade: 'D', color: '#c0392b' };
        return { grade: 'F', color: '#8b0000' };
    }

    // --- Per-card quality: compare actual rank to expected at its position ---
    // Returns { quality: "strong"|"expected"|"weak", delta: number }
    function cardPullQuality(card, sameTypeCards, handSize) {
        if (!initialized || typeof card.rank !== 'number' || !isFinite(card.rank)) {
            return { quality: 'none', delta: 0 };
        }

        var rankArray = card.type === 'Occupation' ? occRanks : minorRanks;
        var N = rankArray.length;
        var n = handSize;

        // Sort same-type cards by rank to find this card's position
        var sorted = sameTypeCards
            .filter(function (c) { return typeof c.rank === 'number' && isFinite(c.rank); })
            .map(function (c) { return c.rank; })
            .sort(function (a, b) { return a - b; });

        var position = sorted.indexOf(card.rank) + 1; // 1-indexed
        if (position === 0) return { quality: 'none', delta: 0 };

        var expected = expectedKthRank(position, n, rankArray);
        if (expected === null) return { quality: 'none', delta: 0 };

        var delta = card.rank - expected; // negative = better than expected

        // Standard deviation for the k-th order statistic position
        var k = position;
        var sdPos = Math.sqrt(k * (n - k + 1) * (N + 1) * (N - n) / ((n + 1) * (n + 1) * (n + 2)));
        // Convert position SD to rank SD (approximate by local rank density)
        var posExpected = k * (N + 1) / (n + 1) - 1;
        var rankDensity = 1; // approximate
        if (posExpected >= 0 && posExpected < N - 1) {
            var lo = Math.max(0, Math.floor(posExpected) - 1);
            var hi = Math.min(N - 1, Math.floor(posExpected) + 1);
            rankDensity = (rankArray[hi] - rankArray[lo]) / (hi - lo);
        }
        var sdRank = sdPos * rankDensity;
        if (sdRank < 10) sdRank = 10; // minimum threshold

        if (delta < -sdRank) return { quality: 'strong', delta: delta };
        if (delta > sdRank) return { quality: 'weak', delta: delta };
        return { quality: 'expected', delta: delta };
    }

    // --- Hypergeometric PMF using recurrence ---
    // Returns array of probabilities P(X=0), P(X=1), ..., P(X=min(K,n))
    // K = tagged cards in pool, N = total pool size, n = draw size
    function hypergeometricPMF(K, N, n) {
        if (N === 0 || n === 0 || K === 0) return [1.0];
        var maxK = Math.min(K, n);
        var probs = new Array(maxK + 1);

        // Start with P(X=0) computed in log space
        var logP0 = 0;
        for (var i = 0; i < n; i++) {
            logP0 += Math.log(N - K - i) - Math.log(N - i);
        }
        probs[0] = Math.exp(logP0);

        // Recurrence: P(k+1) = P(k) * (K-k)(n-k) / ((k+1)(N-K-n+k+1))
        for (var k = 0; k < maxK; k++) {
            var num = (K - k) * (n - k);
            var den = (k + 1) * (N - K - n + k + 1);
            if (den === 0) { probs[k + 1] = 0; continue; }
            probs[k + 1] = probs[k] * num / den;
        }

        return probs;
    }

    // --- Tag distribution for a hand (convolution of Occ + Minor hypergeometrics) ---
    // Returns { probs: [P(total=0), P(total=1), ...], occPMF: [...], minorPMF: [...] }
    function tagDistribution(tag, nOcc, nMinor) {
        if (!initialized || !tagCounts[tag]) return null;

        var kOcc = tagCounts[tag].occ;
        var kMinor = tagCounts[tag].minor;
        var NOcc = occRanks.length;
        var NMinor = minorRanks.length;

        var occPMF = hypergeometricPMF(kOcc, NOcc, nOcc);
        var minorPMF = hypergeometricPMF(kMinor, NMinor, nMinor);

        // Convolve: P(total = t) = sum over i of P(occ=i) * P(minor=t-i)
        var maxTotal = occPMF.length + minorPMF.length - 2;
        var probs = new Array(maxTotal + 1);
        for (var t = 0; t <= maxTotal; t++) {
            var p = 0;
            for (var i = Math.max(0, t - minorPMF.length + 1); i <= Math.min(t, occPMF.length - 1); i++) {
                p += occPMF[i] * (minorPMF[t - i] || 0);
            }
            probs[t] = p;
        }

        return { probs: probs, occPMF: occPMF, minorPMF: minorPMF };
    }

    // --- Get all stats for a hand ---
    function analyzeHand(handCards, handSize) {
        if (!initialized) return null;

        var occCards = handCards.filter(function (c) { return c.type === 'Occupation' && typeof c.rank === 'number' && isFinite(c.rank); });
        var minorCards = handCards.filter(function (c) { return c.type === 'Minor Improvement' && typeof c.rank === 'number' && isFinite(c.rank); });

        var percentile = handPercentile(handCards);
        var grade = handGrade(percentile);

        // Per-card quality
        var cardQualities = {};
        handCards.forEach(function (card) {
            if (card.type === 'Occupation') {
                cardQualities[card.name] = cardPullQuality(card, occCards, handSize);
            } else if (card.type === 'Minor Improvement') {
                cardQualities[card.name] = cardPullQuality(card, minorCards, handSize);
            }
        });

        // Expected ranks for the rank distribution table
        var occExpected = [];
        for (var i = 1; i <= handSize; i++) {
            occExpected.push(Math.round(expectedKthRank(i, handSize, occRanks)));
        }
        var minorExpected = [];
        for (var j = 1; j <= handSize; j++) {
            minorExpected.push(Math.round(expectedKthRank(j, handSize, minorRanks)));
        }

        // Tag distributions for tags present in the hand
        var handTags = {};
        handCards.forEach(function (card) {
            if (card.tags) {
                card.tags.forEach(function (tag) {
                    if (!handTags[tag]) handTags[tag] = 0;
                    handTags[tag]++;
                });
            }
        });

        var tagStats = {};
        Object.keys(handTags).forEach(function (tag) {
            var dist = tagDistribution(tag, handSize, handSize);
            if (dist) {
                tagStats[tag] = {
                    count: handTags[tag],
                    distribution: dist.probs,
                };
            }
        });

        return {
            percentile: percentile,
            grade: grade,
            cardQualities: cardQualities,
            occExpected: occExpected,
            minorExpected: minorExpected,
            tagStats: tagStats,
        };
    }

    return {
        init: init,
        analyzeHand: analyzeHand,
        handPercentile: handPercentile,
        handGrade: handGrade,
        cardPullQuality: cardPullQuality,
        tagDistribution: tagDistribution,
        hypergeometricPMF: hypergeometricPMF,
        expectedKthRank: expectedKthRank,
        isInitialized: function () { return initialized; },
        // Exposed for debugging:
        _occRanks: function () { return occRanks; },
        _minorRanks: function () { return minorRanks; },
        _tagCounts: function () { return tagCounts; },
    };

})();
