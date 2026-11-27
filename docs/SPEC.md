# Build spec: CFO Portal for a multi-store fuel & convenience operator

The CFO's original brief, kept here so every phase builds against the same requirements. Build in phases (section 14); every phase must be usable on its own. Demo data is illustrative: never commit real company figures, owner names or account numbers.

## 1. Purpose and design principles
The single working hub for the CFO of a small group of gas stations / convenience stores in Mississippi: bookkeeping, reconciliation, reporting, budgeting, payroll review, fuel accounting and cash control. A **workbench**: it says what needs doing today, lets the CFO do it in place, and answers any question in seconds.
1. **Answers first, data second.** Every page opens with the 3–5 numbers or exceptions that matter, then detail.
2. **Every number is traceable.** Figure → transactions → source document.
3. **Every total is tied out.** Each report shows a tie-out line ("ties to bank statement ✓ / off by $12.40 ✗"). Nothing is final until it reconciles.
4. **Work queues, not lists.** Anything unmatched, unclassified, missing or overdue lands in a queue with an owner, due date and one-click fix.
5. **Nothing is lost.** Full audit trail (who, what, before/after, when, why). Soft-delete only. Closed months locked.
6. **Fast and neat.** Keyboard-first (⌘K, shortcuts), works on a phone, light/dark, prints cleanly.

## 2. The business
| Code | Location | Notes |
|---|---|---|
| HM11 | Gluckstadt | Fuel supplier Craddock (Exxon). Kitchen (BBQ & fried). Payroll all cash. Tenant rent income. |
| HM13 | Meadville | Craddock. Kitchen. Gusto payroll. |
| HM15 | Crystal Springs | Dash Oil (same owners). Truck lane: Comdata, Mudflap, Fiserv/AccessOne merchant. Kitchen. Gusto. |
| HM17 | Centreville | Dash Oil. Opened Nov 2026. Gusto. |
| HM14 | Gulfport | Leased to an operator. Rent income only; out of operating scope. |
| CORP | Corporate | Office payroll, shared costs, intercompany hub. |

Stores, entities, suppliers, accounts are configurable (a 5th store needs no code change).

**Money reality.**
- One shared operating account (Trustmark) pays bills for every store and the owners' other businesses. $30,000 floor; alert below.
- Heavy intercompany traffic: related parties Dhunna Development and SKD Properties (pay store mortgages; reimbursed through Corporate), Cheers (liquor store next door), Southern Eagle (loans out, repayments in), Rowdy's, Bullseye, Five Rivers, personal draws. Each needs a running due-to/due-from ledger.
- Cash-heavy: register cash counted by manager → picked up by operator → recounted → received at HQ → recounted → pooled and deposited. Cash also pays payroll (HM11), vendors, change, small purchases, owner draws.
- **Fuel settlement is netted.** *Craddock* (HM11, HM13): each EFT notice nets card proceeds, card fees, host discounts/rewards, network fees (Cybera, POS) and fuel invoices into one draft or deposit; every notice nets to zero. *Dash Oil* (HM15, HM17): invoices are paid on their due date out of card proceeds held by Dash (clearing account), not by bank EFT.
- **Truck lane (HM15):** Comdata gallons and sales come from a separate truck-stop summary, not the store POS. Mudflap fuel-code discounts and card true-ups are contra-revenue. Fiserv/AccessOne deposits arrive as "MER BNKCD DEPOSIT"; fees debited the following month.
- **Payroll:** Gusto for HM13, HM15, HM17 and office. HM11 pays cash. Some staff also get cash/check pay outside Gusto: compare by employee and week, never assume a duplicate.
- **Basis:** monthly P&L on cash and accrual. Accrual fuel COGS = gallons sold × that month's delivered cost per gallon (Plus blended 50/50 Regular/Premium); merchandise and food on invoice date.

## 3. Navigation
TODAY · REPORTS (command center, P&L cash/accrual/compare, balance sheet, cash flow, store scorecards, budget vs actual, board pack, report builder) · BOOKS · BANK & CASH · INTERCOMPANY · FUEL · INSIDE STORE · KITCHEN · PEOPLE · PAYABLES · RECEIVABLES · BUDGETS · CLOSE · COMPLIANCE · ASSETS & DEBT · TAX · GROWTH · QUICKBOOKS · CONTROLS · SETUP.

## 4. Modules
### 4.1 Today
Task inbox (unmatched bank lines, uncategorized, missing fuel invoices, un-posted supplier notices, cash variances, bills due ≤7 days, payroll to review, accounts below floor, close tasks, compliance deadlines ≤30 days). Cash position (bank, cash in transit, supplier clearing balances, checks outstanding, projected 7/14/30 days vs floor). Yesterday at a glance. Approvals (bills, raises, write-offs, adjusting entries).

### 4.2 Reports
- **Command center:** one row per store: sales, gross margin, labor %, net profit, company total. Month picker; defaults to latest month with sales and says so.
- **P&L:** cash, accrual, side-by-side with a bridge; by store, month, multi-month trend, % of sales; prior-period and budget comparison; drill-down; lines of business Fuel/Inside/Kitchen/Other.
- **Balance sheet:** bank, cash on hand and in transit, supplier clearing, inventory (fuel, inside), intercompany by party, fixed assets, loans, accrued payroll and taxes, equity/owner draws.
- **Cash flow statement** (indirect) + 13-week forecast.
- **Store scorecards:** KPIs vs thresholds (green/amber/red) with notes.
- **Board / owner pack:** one-click PDF: summary letter, P&L, balance sheet, cash, KPIs, intercompany positions, open issues.
- **Report builder:** pick rows (accounts, categories), columns (stores, months), filters; save and schedule.
- Every report exports to PDF and Excel and has a tie-out footer.

### 4.3 Books
Double-entry GL; fuel-retail chart of accounts; fast entry, bulk edit, splits, attachments, memo/tags, store allocation; JE templates; recurring entries; rules engine with confidence; duplicate detection.

### 4.4 Bank & cash
Bank import, reconciliation, checks register, cash chain, deposit classification, transfers. (Built in phase 2.)

### 4.5 Intercompany & related parties
Party list with type (related company, owner, tenant, lender). Running ledger per party: money out (loans made, bills paid on their behalf), money in (repayments, reimbursements), current balance owed to/by us, aging. Payments made for another business on the shared account post to that party's receivable, not store expenses. Rent pass-throughs (related party pays store mortgage → store rent expense + Corporate intercompany payable) as recurring templates. Owner draws tracked separately with YTD total. Statement per party (PDF). Elimination view: consolidated picture with intercompany netted out.

### 4.6 Fuel
- Gallons & margin by store, grade, day, month: retail price/gal, cost/gal, cpg margin, fuel discounts, card fee per gallon, break-even cpg.
- Invoices & BOLs: supplier, BOL, delivered date, gallons gross/net by grade, cost, freight, taxes, due date, PDF; match to settlement (Craddock notice line or Dash clearing); flag missing invoices, duplicates, price outliers.
- Supplier settlement: **Craddock:** import each EFT notice line by line (card proceeds, fees, adjustments, invoices, Cybera/POS fees, draft or deposit); prove each notice nets to zero; show running receivable at any date. **Dash:** clearing account (card proceeds in, invoices out on due date) with balance owed each way.
- Truck lane: Comdata gallons/sales from its summary; Mudflap fuel-code discounts and card true-ups; Fiserv deposits and next-month fees.
- Tank inventory: daily stick/ATG readings; book-to-physical variance by tank; water and loss alerts; reorder signal (days of supply).
- Pricing log: posted prices vs nearby competitors, margin impact.
- Ordering plan: suggested load timing per store from sales velocity and tank capacity.

### 4.7 Inside store
Department sales from POS with margin by department. Vendor purchases (check, EFT, cash logs) mapped to departments for true department margin. Inventory counts: entry, valuation, shrink % by department. Monthly purchasing budget per store and department with spend-to-date and remaining bar. Scan-data / loyalty rebates: expected vs received. Lottery: sales, payouts, commissions, settlement. Compliance flags: tobacco/alcohol license expiry, age-check audits.

### 4.8 Kitchen
Food sales by day and store; menu mix. Food cost % = (purchases ± inventory change) ÷ food sales, with target and trend. Waste log (item, qty, $, reason) and effect on cost %. Kitchen labor and prime cost (food + labor). Supplier spend (Sysco etc.): price-change alerts on top items.

### 4.9 People & payroll
Import Gusto payroll: per run gross, employee and employer taxes, net, total company debit, check-paid; by employee and store. Cash/check payroll entry for stores outside Gusto, matched to employees and weeks. This week vs last: total and by store, hours, headcount, new hires, terminations, rate changes (flag for approval), overtime. Labor % of sales by store and week; scheduling target. Payroll tax tracker: liabilities vs deposits, quarterly 941/state, W-2/1099 checklist. Raises and rate changes need approval with reason and effective date.

### 4.10 Payables
Bills inbox: upload photo/PDF or forward an email; extract vendor, date, amount, due date, store; CFO confirms. AP aging; payment calendar (by due date and cash available); autopay tracking. **Utilities tracker:** each utility account (Entergy etc.) with service address, store, account number, autopay status, last bill, due date, amount history; flags past-due, disconnect notices, unusual jumps. Vendor statement reconciliation. 1099 tracking.

### 4.11 Receivables & other income
Tenant rent schedule (due vs received, late). Rebates/programs (Reynolds, ITG, Vicksburg, Clark): expected, received, outstanding. ATM income, insurance claims, refunds owed to us.

### 4.12 Budgets & forecasting
Annual budget store × category × month (last year + growth, or zero-based). Budget vs actual on every P&L line with variance $ and % and comments. Rolling forecast (actuals + forecast). Scenarios ("fuel margin −2¢", "new store opens in March", "close kitchen on Sundays"). Break-even per store (fixed costs ÷ contribution margin).

### 4.13 Month-end close
Checklist per month and store with owners and due dates: 1 Sales posted, 2 Fuel invoices tied to settlement, 3 Card fees posted, 4 Bank reconciled, 5 Cash chain balanced, 6 Payroll posted, 7 Intercompany agreed, 8 Accruals booked, 9 Inventory counted, 10 Rent pass-throughs, 11 Review P&L variances, 12 Lock. Status not started / in progress / done / blocked with evidence. Lock period (unlock with reason, logged). Close binder export (PDF/ZIP of statements, reconciliations, schedules, support).

### 4.14 Compliance & documents
Tax calendar (sales, fuel excise, payroll, income, property) with reminders and filed/paid/confirmation record. Licenses and permits (beer, tobacco, food service, UST/environmental, business), insurance policies, leases: expiry dates and documents. Notices tracker (IRS/state letters): status, deadline, response. Document vault: every attachment searchable, linked to transactions, vendors, stores, months.

### 4.15 Assets & debt
Fixed asset register with depreciation schedules. Loans/mortgages: amortization tables, principal vs interest monthly, payoff dates. Equipment maintenance log and warranty dates.

### 4.16 Journal entries & GL toolkit
Manual JEs: multi-line balanced with entity and store per line; reversing with auto-reverse date; recurring with schedule; attachments and required memo; approval over a set amount. Templates: accruals (payroll, utilities, fuel received not invoiced, interest), prepaids (insurance, property tax, licenses), depreciation, intercompany, reclass, owner draw/contribution, inventory adjustment (fuel book-to-physical, inside count), bad-debt write-off. GL detail report. Trial balance unadjusted / adjusting / adjusted by entity with prior-period comparison. Account reconciliations for every balance-sheet account monthly (GL vs support, difference, preparer and reviewer sign-off) for bank, clearing, intercompany, AP, payroll liabilities, sales tax payable, loans, fixed assets. Multi-entity consolidation with eliminations and an elimination entry log.

### 4.17 QuickBooks (two-way, reconciled)
Connect each entity's QBO (OAuth); QBO remains system of record for the CPA if required. Mapping screens: CoA ↔ QBO accounts; stores ↔ classes/locations; vendors/parties ↔ vendors/customers. Pull QBO bank/expense transactions, checks, bills, bill payments, de-duplicated. Push approved JEs and monthly summary entries; store QBO id. Differences report: portal TB vs QBO TB by account and month; nothing pushed into a locked month. Sync log with errors and fixes.

### 4.18 Tax
Entity map (classification, EIN, owners and %, state registrations, fiscal year, preparer, prior returns). Tax calendar and return tracker for every return/payment with status and confirmation. Sales tax: taxable sales vs collected vs remitted, variance, filing worksheet. Book-to-tax workpapers (depreciation differences, meals 50%, penalties, owner items, accrual-to-cash) → taxable income per entity; M-1/M-2 support. Tax depreciation: book and tax side by side (MACRS, 179, bonus, QIP, cost-seg flags for canopies, USTs, site work). Accounting methods (inventory/UNICAP, cash vs accrual gross-receipts test, Form 3115 tracking). Estimated taxes per owner/entity with safe harbor. K-1 and owner tax: share of income, distributions, basis and capital roll-forward, distribution capacity vs tax due. Planning panel: projected taxable income and levers with tax saved. Notices. CPA package export.

### 4.19 Debt, treasury & capital structure
Debt dashboard (lender, balance, rate, fixed/variable, payment, maturity, collateral, guarantor, prepayment penalty, covenants); interest to date and projected; weighted-average cost of debt; maturity ladder. Covenant monitor (DSCR, debt/EBITDA, min liquidity, fixed-charge coverage) monthly with headroom and forecast breach date; lender package export. Refinance analyzer (payment change, interest saved, break-even months, NPV, DSCR before/after, cash freed). Refinance triggers (rate gap with break-even, maturity within 12 months, LTV drop, variable above fixed alternative, covenant forecast to breach). Paydown vs invest (after-tax cost of debt vs after-tax return; avalanche order once reserve met; effect on DSCR, liquidity, next-store timing). Cash reserve policy (N weeks of fixed costs + one fuel load per store + payroll; excess = deployable with ranked uses). Related-party loans with terms and imputed-interest flags.

### 4.20 Growth
Expansion readiness scorecard (TTM EBITDA and trend; 3 quarters stable same-store profit; every store ≥ break-even; reserve met plus equity on hand; DSCR ≥ target after new debt; leverage ≤ target; management bandwidth; last store hit ramp targets). Site scorecard (AADT, visibility, access, competition, population, truck traffic, zoning, environmental, utilities, income; weighted score vs existing sites). New store pro forma for buy/build/lease (volumes, margins, other income, costs, ramp, capital needs, incentives, financing → 10-year monthly P&L, EBITDA, cash after debt service, cash-on-cash, unlevered/levered IRR, NPV, payback, DSCR by year, break-evens, sensitivity tables). Buy vs build vs lease comparison. Acquisition model (normalized seller financials, valuation by EBITDA multiple / per-gallon / real estate + business, QoE checklist, due-diligence tracker). Capital allocation view. Company valuation quarterly.

### 4.21 Owner returns & distributions
Distributions by owner YTD and lifetime; ROE and ROIC by store. Safe distribution = cash above reserve − near-term capex − tax estimates due − debt-service cushion. Tax distributions = projected taxable income × owner rate.

### 4.22 Internal controls & risk
Segregation of duties (enter / approve / pay; conflicts flagged). Approval limits by role and amount (bills, JEs, write-offs, rate changes). Cash controls (dual counts, blind HQ counts, deposit within N days, variance trends by person and store). Fraud signals (duplicate vendors/bank accounts, round-dollar payments, payments just under approval limits, voids/refunds by cashier, drive-offs, lottery shortages, payroll for terminated employees, ghost employees, sudden rate changes). Insurance and risk register. Environmental/UST compliance.

### 4.23 Search & ask
⌘K command bar. Natural-language questions answered from the data with transactions as proof ("what did we pay Entergy for HM11 in October", "outstanding Craddock invoices as of yesterday", "gallons sold this month at HM15 including Comdata"). Never invent a number; say exactly what's missing.

## 5. Data model rules
Money as integer cents; every row carries store, entity and period; soft delete only; every change writes the audit log with before and after.

## 6. Accounting rules (non-negotiable)
1. Two bases: cash (settlement/clear date; uncleared checks excluded) and accrual (transaction date; accrual COGS replaces paid fuel, merchandise and food purchases). Always a bridge.
2. Craddock dating: card batch = sales day (processing date − 1); fuel invoices and network fees = the notice that nets them; draft/deposit = next business day; every notice nets to zero.
3. Dash invoices paid on their due date through Dash clearing, not the bank.
4. Card fees per month = that month's fee lines + network fees dated to the notice that charged them.
5. Intercompany and transfers never touch P&L unless explicitly classed as expense.
6. Owner withdrawals follow a configurable policy (draw vs expense), applied consistently. Current policy: Corporate · Miscellaneous expense.
7. Payroll expense = net pay; payroll tax = employee + employer taxes; booked by pay date.
8. Materiality: under $5 ignored; $5+ or a repeated pattern flagged.
9. Every reported total reconciles to its source's own totals before shown as final. Exclude voided lines, $0/suspended transactions and prepaid-fuel duplicates.
10. Property tax, insurance and annual fees are prepaid and amortized monthly.

## 7. Integrations
Pluggable importers with file-upload fallback: POS (PDI C-Store Essentials / CStorePro), bank, Craddock notices and invoices, Dash/Marathon myMPC, Comdata/Mudflap/Fiserv, Gusto, QuickBooks Online, email inbox, utility portals, Google Sheets logs. Every import shows a preview with totals that tie, is idempotent, and records its batch id on every row.

## 8. KPIs
Fuel (gallons, cpg margin, fuel GP, discounts/gal, card fee/gal, variance gallons, days of supply) · Inside (sales, GM %, margin by dept, shrink %, avg ticket, transactions/day) · Kitchen (food sales, food cost %, waste %, prime cost %) · Labor (payroll $, labor %, hours, sales per labor hour, OT) · Store (net profit, EBITDA, break-even sales, cash variance, card fee %) · Company (cash, days cash, intercompany net, AP days, DSCR) · Profitability (growth YoY/same-store, EBITDA & margin, net margin, EBITDAR, profit per store, profit per gallon) · Returns (ROIC, ROE, cash-on-cash, payback, IRR per store) · Liquidity (current, quick, days cash, CCC, 13-week minimum) · Leverage (debt/EBITDA, debt/equity, DSCR, FCC, interest coverage, LTV, WACD) · Efficiency (sales/sq ft, sales/labor hour, inventory turns, DSO/DPO, card fee % trend, utilities per store) · Growth readiness · Valuation.

## 9. Alerts
Bank below floor or projected below within 14 days; cash variance > $5; deposit not made within N days; fuel invoice with no settlement match; notice not netting to zero; tank variance; bill due in 3 days unscheduled; utility past due / disconnect; payroll WoW change > 15%, any rate change, any new hire; fuel cpg or food cost outside target; close task overdue; compliance item expiring in 30 days; intercompany balance above limit; covenant breach forecast within 2 quarters; DSCR below target; maturity within 12 months; refinance opportunity; variable above fixed; deployable cash above reserve 2+ months; expansion scorecard changes; estimated tax due in 14 days; return deadline in 30 days; sales tax collected ≠ remitted; new notice; QBO difference > $5.

## 10. Roles & safety
CFO (all), bookkeeper (no lock/unlock), store manager (own store: cash counts, logs, bill upload), owner (read-only + approvals), outside accountant (read + export). 2FA, encryption at rest, daily backups, no bank credentials stored, row-level store access, every export logged.

## 11. Design
See CONVENTIONS.md. "Forecourt": asphalt canopy, concrete page, Interstate blue actions, Hotspot red mark; Barlow + Barlow Condensed; tabular figures; negatives in parentheses; no gradients/glows/shadows; hairlines; WCAG 2.1 AA with zero axe violations; phone bottom tab bar.

## 12. One-screen workflows
Morning check · Post a Craddock notice · Reconcile the bank · Weekly payroll review · Cash day · Pay bills · Month-end close · Answer the owner · Quarterly CFO review · Evaluate a deal · Year-end.

## 13. Non-functional
Loads < 2 s; 50k-row tables smooth; offline read; CSV/Excel from every list, PDF from every report; America/Chicago; configurable fiscal year; automated tests; demo dataset.

## 14. Phases
1 Foundation ✓ · 2 Bank & cash ✓ · 3 Fuel · 4 Reports · 5 Intercompany & payables · 6 People · 7 Inside & kitchen · 8 Budgets & close · 9 Compliance, assets & ask · 10 GL & QuickBooks · 11 Tax · 12 Debt & treasury · 13 Growth & owners · 14 Controls & risk.

Definition of done for each phase: demo data loads; every total ties to its source with a visible tie-out; tests pass; zero accessibility violations; works at 390 px and 1440 px; a "how to use this screen" note ships with it.
