// Strategy advisor module for Agricola draft tool
// Handles Azure Function call for LLM-powered draft strategy analysis.
// Uses `var` for Babel standalone compatibility.

var STRATEGY_FUNCTION_URL = '/api/strategy';

var strategyAdvisor = (function () {

    // --- Call the strategy Azure Function ---
    // handNames: array of card names in the current hand
    // draftedNames: array of card names already drafted
    // othersDrafted: array of card names taken by opponents
    // currentRound: number (1-7)
    function getAdvice(handNames, draftedNames, othersDrafted, currentRound) {
        return fetch(STRATEGY_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                handNames: handNames,
                draftedNames: draftedNames,
                othersDrafted: othersDrafted,
                round: currentRound,
            }),
        }).then(function (response) {
            if (response.status === 429) {
                throw new Error('Too many requests. Try again in a few minutes.');
            }
            if (!response.ok) {
                return response.json().catch(function () { return {}; }).then(function (data) {
                    if (data.error) throw new Error(data.error);
                    if (response.status === 501) throw new Error('The strategy service is not set up yet.');
                    if (response.status === 503) throw new Error('The strategy service is temporarily unavailable. Try again later.');
                    if (response.status >= 500) throw new Error('The strategy service ran into a problem. Please try again.');
                    throw new Error('Could not get strategy advice. Please try again.');
                });
            }
            return response.json();
        });
    }

    // --- Check if the strategy endpoint is reachable ---
    function checkAvailability() {
        return fetch(STRATEGY_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then(function (response) {
            // Any response (even 400) means the server is reachable
            return true;
        }).catch(function () {
            return false;
        });
    }

    return {
        getAdvice: getAdvice,
        checkAvailability: checkAvailability,
    };

})();
