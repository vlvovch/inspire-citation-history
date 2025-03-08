# INSPIRE Citation History

A web-based tool to visualize citation history for academic papers indexed in the INSPIRE-HEP database.

## Overview

This project provides a simple, interactive web interface to track and compare citation histories of high-energy physics papers over time. It's inspired by GitHub's star history visualization but applied to academic citations.

## Features

- Track citation history for multiple papers simultaneously
- Compare citation trajectories across different papers
- Option to align timelines to normalize publication dates
- Direct integration with the INSPIRE-HEP API
- Support for INSPIRE-HEP record IDs and URLs

## Usage

1. Open `inspire-citation-history.html` in your web browser
2. Enter an INSPIRE-HEP record ID in the input field (e.g., `2178285`) or paste a full INSPIRE-HEP URL (e.g., `https://inspirehep.net/literature/2178285`)
3. Click "Add record" to add the paper to your visualization
4. Add multiple papers to compare citation histories
5. Toggle "Align timeline" to normalize all citation histories to start at the same point
6. Click "View citation history" to update the chart
7. Click "Clear all" to remove all records and reset the chart

## Technical Details

The application is built as a single HTML file with embedded JavaScript that:

- Makes API calls to the INSPIRE-HEP database to retrieve citation data
- Processes the raw citation data into time series format
- Visualizes the data using the chart.xkcd library for a hand-drawn aesthetic
- Maintains state in the URL for easy sharing of visualizations

## Dependencies

- [Chart.js](https://www.chartjs.org/) - Base charting library
- [chart.xkcd](https://github.com/timqian/chart.xkcd) - For the hand-drawn chart style
- [date-fns](https://date-fns.org/) (via chartjs-adapter-date-fns) - For date handling

## License

This project is open source and available under the MIT License.

## Acknowledgments

- INSPIRE-HEP for providing the API to access citation data
- [GitHub Star History](https://star-history.com) for the inspiration
