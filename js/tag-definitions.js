// Strategy tag definitions — shared between index.html and draft.html
// Uses `var` (not `const`) for Babel standalone compatibility in draft.html
var TAG_DEFINITIONS = {
    'Small House':       { abbrev: 'SmH', color: '#e67e22' },
    'Big House':         { abbrev: 'BH',  color: '#8e44ad' },
    'Stone House':       { abbrev: 'StH', color: '#607d8b' },
    'Day Laborer':       { abbrev: 'DL',  color: '#e74c3c' },
    'Grain':             { abbrev: 'G',   color: '#f1c40f' },
    'Major/Minor':       { abbrev: 'MM',  color: '#9b59b6' },
    'Fishing':           { abbrev: 'F',   color: '#3498db' },
    // The Traveling Players action space exists only at 4 and 5 players, so
    // cards keyed to it are effectively dead in a 3-player game. See
    // docs/agricola-rules-reference.md, section 8.
    'Traveling Players': { abbrev: 'TP',  color: '#e91e9e', minPlayers: 4 },
    'Sow':               { abbrev: 'Sow', color: '#2ecc71' },
    'Lesson':            { abbrev: 'L',   color: '#2980b9' },
    'Stable':            { abbrev: 'ST',  color: '#7f8c8d' },
};

// Tags available at a given player count. Use this anywhere the player count is
// known rather than iterating TAG_DEFINITIONS directly.
function tagsForPlayerCount(playerCount) {
    var pc = playerCount || 4;
    var out = {};
    Object.keys(TAG_DEFINITIONS).forEach(function (name) {
        if ((TAG_DEFINITIONS[name].minPlayers || 0) <= pc) out[name] = TAG_DEFINITIONS[name];
    });
    return out;
}
