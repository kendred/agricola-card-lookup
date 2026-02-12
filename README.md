# Agricola Card Lookup

A searchable, sortable, filterable interface for Agricola card rankings with 773 cards.

## Files

### For immediate use:
- **index.html** - Single-file version with everything embedded (just open in browser)

### For development/editing:
- **index-external.html** - HTML that references external files
- **style.css** - All styles
- **script.js** - All JavaScript (includes embedded card data)
- **agricola-cards.json** - Card data (773 cards with rankings and stats)

## Features

- **Search**: Autocomplete search for any card name
- **Sort**: Click column headers to sort by any metric
- **Filter**: Filter by card type (Occupation/Minor Improvement) or passing status
- **Color Gradients**: Visual indicators for Play Rate, Value, and When Played
- **Tooltips**: Hover over (?) icons to see metric explanations
- **Responsive**: Works on desktop and tablet

## Usage

### Quick Start
1. Open `index.html` in any modern web browser
2. Search, sort, and explore!

### Development
1. Open `index-external.html` in a browser
2. Edit `style.css` for styling changes
3. Edit `script.js` for functionality changes
4. Note: script.js has embedded card data - to update data, edit `agricola-cards.json` and regenerate

## Data Source

Card rankings and statistics from Agricola competitive play data.

## Browser Compatibility

Works in all modern browsers (Chrome, Firefox, Safari, Edge).
