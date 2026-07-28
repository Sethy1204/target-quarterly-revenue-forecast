# Target Corporation Quarterly Revenue Forecasting

Time-series forecasting of Target Corporation's quarterly net sales using OLS regression with seasonal dummy variables and a time-trend interaction term.

## Overview

Retail revenue is strongly seasonal — Target's fiscal year ends in late January, so fiscal Q4 is the November–January holiday quarter and the clear annual peak. A plain time trend misses that sawtooth entirely. This project builds two regression specifications, evaluates them on a held-out test window, and produces a four-quarter forward forecast with prediction intervals.

## Data

- **Source:** `qSales_2024.csv` — a Compustat quarterly extract covering three companies (Target, Apple, Nintendo); the analysis filters to ticker `TGT`
- **Coverage:** 93 Target quarters, fiscal Q1 2001 through fiscal Q4 2023 (period ending January 2024)
- **Measure:** `saleq`, quarterly net sales in millions USD
- **Average revenue by fiscal quarter:** ~$15.9B (Q1), ~$16.4B (Q2), ~$16.6B (Q3), ~$21.1B (Q4)

## Method

1. Plotted the revenue series to identify trend and seasonality
2. Added a sequential time index (1–93)
3. Built `q2`, `q3`, `q4` dummy variables with Q1 as the baseline quarter
4. Added a `time × q4` interaction so the holiday premium can widen over time
5. Split chronologically 75/25 — 69 training quarters, 24 test quarters (April 2018 – January 2024)
6. Fit and compared a linear and a log-linear specification on test-set MAPE
7. Refit the winning model on full history and forecast four quarters ahead with 80% prediction intervals

The log specification treats seasonality as a multiplicative percentage effect rather than a fixed dollar amount, which suits retail revenue better.

## Results

| Model | Specification | Test MAPE |
|---|---|---|
| Model 1 | Linear, with `time × q4` interaction | 11.95% |
| Model 2 | Log-linear, seasonal dummies | 8.97% |

The log-linear model was selected. Training R-squared: 0.865.

### Four-quarter forecast

Refit on all 93 quarters, with 80% prediction intervals:

| Quarter | Period ending | Forecast ($M) | 80% low | 80% high |
|---|---|---|---|---|
| FY24 Q1 | 2024-04-30 | 24,481 | 21,516 | 27,856 |
| FY24 Q2 | 2024-07-31 | 25,348 | 22,278 | 28,843 |
| FY24 Q3 | 2024-10-31 | 25,684 | 22,572 | 29,224 |
| FY24 Q4 | 2025-01-31 | 33,523 | 29,460 | 38,147 |

The holiday quarter again dominates, consistent with the historical seasonal pattern.

## Tools

Python · pandas · NumPy · statsmodels · matplotlib · Google Colab

## Files

- `target_revenue_forecast.ipynb` — full analysis notebook
- `qSales_2024.csv` — source data

## Notes

Completed as coursework for AFM 244 (Data Analytics) at the University of Waterloo.

