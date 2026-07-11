# Finance Tracker

A small, dependency-light web app for tracking personal income and expenses.
Everything runs in the browser — transactions are kept in `localStorage`, so
there's no account, no server, and nothing to install.

**Live demo:** https://dhruvvdave.github.io/finance-tracker/

## Features

- Add income and expenses with a category and date
- Filter by month or category, search, and sort by date or amount
- Summary cards with month-over-month comparisons
- Charts for income vs expenses, spending by category, and a six-month trend
- Period statistics: average daily spend, largest expense, savings rate
- CSV export of whatever the current filters show
- Light and dark themes (follows your system preference by default)
- Delete with undo, so a mis-tap doesn't cost you data

## Running locally

It's a static site with no build step:

```sh
git clone https://github.com/dhruvvdave/finance-tracker.git
cd finance-tracker
python3 -m http.server 8000   # or any static file server
```

Then open http://localhost:8000. Opening `index.html` directly from disk also
works.

## How it's built

- Plain HTML, CSS, and JavaScript — no framework, no bundler
- [Chart.js](https://www.chartjs.org/) (pinned, via CDN) for the charts
- `index.html` is the markup, `styles.css` holds the design tokens and layout,
  and `app.js` contains all state, rendering, and storage logic

## Data & privacy

Transactions never leave your browser. They're stored under the
`transactions` key in `localStorage` and can be exported to CSV at any time.
Clearing your browser's site data erases them.
