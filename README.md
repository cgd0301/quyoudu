# 趣有度 (QuYouDu)

**A deterministic cash-flow feasibility and plan-comparison tool for large, multi-payment, date-bound optional spending by young people.**

The initial scenario is a cross-city concert trip: one large commitment that splits into several payments on fixed dates — ticket, outbound travel, return travel, lodging — while living costs keep being charged against the same balance. QuYouDu answers a narrow question that a monthly budget cannot: *on each payment date, is this plan actually payable with the money that will be available that day?*

```
17th "ICBC Cup" National College Students FinTech Innovation Competition
Hong Kong Region · Youth Services direction
Team NaiLung · The Hong Kong Polytechnic University
```

> **Simulated data.** Every case, quote, discount and price history in this repository is synthetic, generated for rule and technical validation. The prototype does **not** connect to bank accounts, does **not** move or hold money, does **not** fetch live ticket/hotel/transport prices, and performs **RMB calculations only**. Nothing here is financial, credit or investment advice.

---

## Table of contents

- [Overview](#overview)
- [The problem](#the-problem)
- [How it works](#how-it-works)
- [Feature status](#feature-status)
- [Known limitations](#known-limitations)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Testing and verification](#testing-and-verification)
- [Documentation and deliverables](#documentation-and-deliverables)
- [Team](#team)
- [License and disclaimer](#license-and-disclaimer)
- [Engineering constraints](#engineering-constraints)

---

## Overview

Young consumers routinely make optional purchases that are large relative to their monthly income and split across several payment dates. Saving up is not the hard part alone; the hard part is that **money arrives on one schedule and leaves on another**. A plan can be affordable in total and still fail on a specific date, and once a date, an amount or an income event changes, the whole comparison has to be redone by hand.

QuYouDu is a **decision-support layer** for exactly that step. The user supplies complete candidate plans plus their cash position, expected income and necessary living costs. The engine sets living costs aside, walks the payment timeline node by node, reports the earliest date on which a plan would fall short and by how much, excludes plans that break hard constraints, ranks the remaining ones by net spend, and recomputes everything when an input changes. After the user confirms a plan, it is frozen into an action list.

It deliberately does **not** try to be a bank, a payment channel, a lending product, a travel planner or a price scraper. It produces one thing well: an explainable, reproducible verdict about future payment feasibility, together with the reasons behind it.

## The problem

Six failure modes recur in this spending pattern, and they are not the same problem:

| Failure mode | What the user experiences |
| --- | --- |
| Budget shortfall | The plan costs more than the money available in total. |
| Payment-date mismatch | The total is sufficient, but one payment falls before the income that was supposed to cover it. |
| Uncertain income timing | The income date slips; every downstream verdict changes. |
| Re-computation cost | One changed field forces the user to redo the whole comparison by hand. |
| Comparison difficulty | Several complete plans exist, each with a different mix of price, dates and constraints. |
| Data sensitivity | Users hesitate to hand over financial details to an unknown tool. |

Existing everyday tools tend to answer adjacent questions. Ledger apps describe money already spent; budgeting apps describe what is left this month; spreadsheets can model anything but must be rebuilt for every change; payment-app ledgers and bank apps are authoritative about the past but not predictive about a specific future payment date.

**Evidence, and its limits.** The project ran a 30-response anonymous questionnaire (16 respondents in Hong Kong, 14 in mainland China; convenience/non-probability sample, collected 2026-10-18). In this sample: 22/30 reported at least one funding-arrangement problem, 17/30 reported anxiety or hesitation, 13/30 said plans must be recalculated when something changes, 13/30 wanted to compare several complete plans, 16/30 raised privacy concerns — while only **4/30** selected "sufficient overall, but short on a specific payment date".

That last number matters: the strict payment-date-mismatch hypothesis is a minority mechanism in this sample, which is why the product is positioned around *comparison and recalculation* as much as around date-level gaps. A separate 18–30 target-age cut (n=25, of which 22 are 18–20) shows the same direction and a **weaker** willingness to pay (5/25 = 20.0%, versus 8/30 = 26.7% overall). These are exploratory sample counts, not population estimates; full tables and reverse evidence are in [docs/_work/survey/report.md](docs/_work/survey/report.md) and [docs/_work/survey/findings.md](docs/_work/survey/findings.md).

## How it works

1. **Describe the need.** The user states the event, cities, budget, cash on hand and expected income. Free text is extracted into 13 fields, and every extracted value starts as an *unconfirmed* value.
2. **Confirm the inputs.** Nothing extracted by a language model enters calculation directly. The user confirms field by field; only confirmed values are written into the case input and into a new input version.
3. **Price the plan.** Costs are summed per cost item as *paid + future payable − eligible refunds*, using a five-tier price-basis ladder (valid quote → confirmed forecast → reference price → undated quote → missing) and explicit discount/offer rules. No basis means no invented number.
4. **Build the timeline.** Payments, income, reserve establishment and contingency release are ordered by date. Same-day order is only taken from explicit input; when unknown, outflows are placed before inflows that are not confirmed as received, and multi-outflow days report a day-level cumulative gap instead of guessing which payment failed first.
5. **Judge every node.** Each node is classified as *pass*, *payment gap*, *protected-funds shortfall* or *allocation conflict*, with the earliest actionable gap reported separately from the full gap list.
6. **Filter and rank candidate plans.** Complete candidate combinations are supplied by the user — the engine never invents combinations. Each candidate is checked against the applicable compatibility constraints, excluded with a reason, or ranked by expected net spend; only the top-K are surfaced, with ties handled deterministically.
7. **Recalculate on change.** Any edit creates a new input version and a full recomputation. Confirmations recorded against an earlier version are marked *needs re-confirmation* rather than silently reused.
8. **Confirm and freeze.** Confirmation writes the formal arrangement and freezes an action list (item, channel, purchase date, payment date, applicable offer). Later recalculation updates risk and feasibility but does not rewrite a frozen list.

A fourth output sits alongside the plan verdict: a **daily non-planned-spending reference**, computed by searching for the largest extra amount that still keeps the whole timeline passing. It is shown as an amount, as *"new unplanned spending is not recommended today"*, or as *"no reliable amount can be given"* — three distinct states that the UI must keep apart.

## Feature status

### Implemented and verified

- **Deterministic engine.** Integer-cent money throughout, one simulated clock (`as_of`), no `Date.now()`, no unseeded randomness, no network access. Repeated runs on the same input produce byte-identical output.
- **Per-node cash-flow judgement** with reserve partitioning (`U = H − A`), protected-funds shortfalls, allocation conflicts, earliest gap and continued-gap handling.
- **Candidate comparison** over user-supplied complete plans: compatibility constraints, exclusion reasons, three mutually exclusive counters (evaluated / excluded / pending), deterministic top-K with tie rules.
- **Confirmation and action list**, including a suggested allocation amount `ΔA` computed so that the *minimum* unallocated balance across the checked period does not decrease — not so that every node stays unchanged.
- **Daily reference** by probe search, with the three display modes above and a documented limiting node.
- **Price-basis ladder and offer rules**, including non-stackable and unconfirmed offers degrading to *pending* instead of being optimistically applied.
- **Forecast with gates.** A damped-trend (Holt) forecaster runs only with enough comparable history and a backtest that is not worse than the baseline; otherwise the status is *insufficient history* and no number is shown.
- **Recent-month scenario** with explicit availability reasons when the observation window is incomplete.
- **One typed result contract** (`ResultCore`, validated with zod) in which every amount carries its value in integer cents plus a `basis` recording the rules and events behind it.
- **Four-page prototype UI** (overview, comparison, calendar, plan management) that only consumes `ResultCore` and performs no money, state or ranking calculation of its own.
- **Natural-language layer with offline replay.** Extraction, clarification and draft handling exist, but only against recorded fixtures; live model calls are not part of the tested path.

### Partially implemented or incompletely tested

- **UI-level test coverage.** Of 21 registered UI sub-cases, 13 have a dedicated end-to-end test, 3 have only supplementary assertions, and **5 remain uncovered** (`T001-03`, `T009-06`, `T013-01`, `T020-02`, `T020-04`). The interface is therefore **not** counted as fully verified; the missing ones need either a UI location that does not exist yet (forecast backtest metrics) or contract-level assertions.
- **Vector coverage of the pricing group.** Vector group `M2` currently registers zero vectors; pricing and offer behaviour is covered by unit tests instead. This is a registration gap, not a claim that the behaviour is untested.
- **Result-contract expressiveness.** A few assertions cannot be expressed as vectors and are tracked as registered gaps in [docs/_work/vector_gaps.md](docs/_work/vector_gaps.md).

### Planned or not yet verified

- HKD support and cross-currency cash flow (see limitations below).
- Account-data integration to reduce manual entry.
- Live price ingestion.
- Any real-user task testing, price testing, retention measurement or institutional procurement interest.
- Automated generation of candidate combinations — deliberately out of scope, not a pending feature.

## Known limitations

- **RMB only.** Rule `R008` accepts RMB amounts; non-RMB input is reported as *cannot be fully determined*. There is no FX conversion, no FX-rate validation and no cross-currency cash flow. HKD scenarios are a roadmap item, not a capability.
- **No account connection.** The tool never reads real transactions. Every figure comes from what the user types.
- **No execution.** It does not transfer, pay, book or reserve anything.
- **No live prices.** Ticket, travel and lodging prices are user-supplied or simulated; the five-tier ladder exists to keep unknown prices unknown rather than to fetch them.
- **Plans must be complete.** The engine checks, excludes and ranks the combinations it is given; it does not search a product catalogue.
- **Feasibility is conditional.** A verdict means "payable under the current inputs and assumptions", never "your income will arrive" and never "you can afford it".
- **Sample size.** Survey results come from 30 convenience-sampled respondents; the 18–30 target-age subset is 25 people, 22 of them 18–20. No population inference is drawn.
- **No market sizing.** No TAM/SAM/SOM point estimate is given, because the necessary adoption parameters do not exist; a symbolic formula and the exact missing inputs are documented instead.
- **No pricing or revenue claims.** There is no validated price point, conversion rate, retention figure or acquisition cost.

## Architecture

```
Input layer                 Deterministic engine                         Contract          Delivery layer
──────────────────          ────────────────────────────────────────      ──────────────    ──────────────────
CaseFile (JSON)       →     normalize → snapshot → states                ResultCore   →    four-page UI
operation whitelist         → timeline → cost → pricing                  (zod schema)      engine exports
demo flows                  → compare → confirm → daily                                    figures
                            → scenarios → holt                                               project book
──────────────────────────  ────────────────────────────────────────
src/nl (language layer) →   may only produce *unconfirmed* values; never writes amounts,
                            states or ordering into a result
```

**Engine.** `src/engine/` is the only place where money, dates, constraints, ranking and forecasts are computed. It is organised into `normalize`, `snapshot`, `states`, `timeline`, `cost`, `pricing`, `compare`, `confirm`, `daily` (with `scenarios`), and `holt`, plus supporting `ops`, `issues` and `money` modules. `evaluate.ts` turns one input version into one or more checkpoints; `result.ts` defines the result contract; `modules.ts` declares the module identifiers `M1`–`M9` used by the vector runner and by [docs/_work/vector_modules.md](docs/_work/vector_modules.md).

**Rules.** Behaviour is specified in [docs/rules.md](docs/rules.md) as rules `R001`–`R020` and detailed clauses `D01`–`D88`. Scope and out-of-scope statements live in [docs/scope.md](docs/scope.md); product-policy statements live in [docs/policy_card.md](docs/policy_card.md).

**Money and time.** All amounts are integer cents (`Number.isSafeInteger`); formatting goes through a single `formatCents` helper. Time comes from one simulated `as_of` clock. Both rules exist so that a result can be recomputed exactly, not approximately.

**Language layer.** `src/nl/` holds the contracts, session state machine, transport adapter and explanation checks. Offline fixtures under `fixtures/llm-replay/` drive the tests. Model output is structurally incapable of reaching the engine as a computed value.

**UI.** `src/App.tsx` renders four pages and reads only `ResultCore`. Presentation rules that need unit testing are extracted into `src/ui/` (for example `dailyText.ts`, which decides when the daily reference shows an amount versus a status sentence). React 19 + Vite 8 + ECharts; no routing library, no state library.

**Tooling.** zod for input/result schemas, decimal.js for forecast arithmetic, vitest for unit tests, Playwright for end-to-end tests, and `scripts/*.ts` for export, reporting, traceability, figure generation and the A4 project-book build.

## Repository structure

```
quyoudu/
├── src/
│   ├── engine/              # deterministic engine (49 TypeScript files)
│   │   ├── normalize/ snapshot/ states/ timeline/ cost/ pricing/
│   │   ├── compare/ confirm/ daily/ scenarios/ holt/
│   │   ├── ops/ issues/ money/
│   │   ├── evaluate.ts      # one input version → checkpoint(s)
│   │   ├── result.ts        # ResultCore contract (zod)
│   │   └── modules.ts       # module ids M1–M9
│   ├── nl/                  # language layer (offline replay only)
│   ├── ui/                  # presentation-only helpers (unit-tested)
│   └── App.tsx              # four-page prototype UI
├── tests/
│   ├── unit/                # 32 vitest files
│   ├── e2e/                 # 2 Playwright specs (17 tests)
│   ├── golden/              # frozen results (protected baseline)
│   └── lib/
├── fixtures/
│   ├── cases/               # 10 controlled input cases
│   ├── vectors/             # 152 test vectors
│   ├── flows/               # 14 demonstration flows
│   └── llm-replay/          # language-layer replay fixtures
├── scripts/                 # 28 build/export/report scripts
├── book/
│   ├── chapters/            # 16 chapter sources (Appendix B is generated)
│   ├── data/                # exported engine results (28 files)
│   ├── figures/             # 23 SVG figures + figure index
│   ├── build/               # locally generated Markdown (git-ignored)
│   └── meta.yml             # cover metadata
├── docs/                    # rules, scope, sources, traceability, work records
├── submission/              # screenshots and the generated A4 PDF
├── oracle/                  # independent Python reference implementation
├── public/
├── AGENTS.md                # engineering rules for AI agents and contributors
├── package.json
├── playwright.config.ts
├── vite.config.ts
├── vitest.config.ts
└── tsconfig.json
```

`node_modules/`, `dist/`, `book/build/*`, `.cache/` and the raw questionnaire export are intentionally excluded from version control.

## Getting started

**Requirements**

- Node.js 24 and pnpm 12 (`packageManager: pnpm@12.11.2`)
- Chromium via Playwright for end-to-end tests and PDF rendering
- Python 3.11 only if you want to run the independent reference implementation (`pnpm diff:oracle`); not needed to run the app or the test suites

```powershell
pnpm install --frozen-lockfile
pnpm dev                                  # Vite dev server, http://localhost:5173
```

**Verification commands**

```powershell
pnpm typecheck                            # tsc --noEmit
pnpm lint                                 # oxlint
pnpm test                                 # vitest unit suite
pnpm check                                # typecheck + lint + unit tests
pnpm check:all                            # check + spec:lint + golden:check
pnpm exec playwright install chromium     # once, before e2e
pnpm test:e2e                             # Playwright (starts its own Vite server)
```

**Data, figures and the project book**

```powershell
pnpm vec --all            # run all test vectors
pnpm validate:cases       # validate case/vector structure and submission constraints
pnpm export:results       # re-export controlled results into book/data
pnpm figures              # regenerate book/figures/*.svg and the figure index
pnpm test:report          # regenerate Appendix B and book/data/status.json
pnpm doc:lint             # documentation checks
pnpm count:chars          # abstract / product-advice length limits
pnpm book:build           # compose book/build/趣有度_项目书.md (git-ignored)
pnpm book:pdf             # typeset the A4 PDF and screenshot every page
```

`book:build` refuses to run with a missing chapter, a missing figure, an unresolvable data placeholder, or fewer than 15 figures; `book:pdf` refuses to emit a PDF on a missing image, an undefined footnote, a pagination overflow, or a page-count mismatch between layout and PDF. Regenerate in the order above when rules or data change.

**Configuration.** No `.env` file and no credentials are required. The application and both test suites run offline. `E2E_PORT` overrides the Playwright port; `SHOT_DIR`, `SHOT_WIDTH` and `SHOT_HEIGHT` override screenshot output. Do not commit real credentials or real respondent data.

## Testing and verification

Everything in the "executed during this task" column was run while preparing this README on 2026-10-19; nothing is copied from an older record.

| Suite | Command | Executed during this task | Notes |
| --- | --- | --- | --- |
| Type check | `pnpm typecheck` | **passed** | `tsc --noEmit`, includes `scripts/` |
| Unit tests | `pnpm test` | **1,194 passed, 1 skipped** (32 files, 1,195 registered) | the skipped case is registered with its reason in the test file |
| End-to-end | `pnpm test:e2e` | **17 passed** (2 spec files) | console errors fail the run |
| Test vectors | `pnpm vec --all` | **152/152 vectors, 1,004/1,004 assertions, 0 run errors** | one vector contains many assertions, so the two counts are not additive |
| Case/vector validation | `pnpm validate:cases` | **passed** (10 cases, 152 vectors) | also enforces submission-data constraints |
| Golden baseline | `pnpm golden:check` | **passed** | frozen results match |
| Specification lint | `pnpm spec:lint` | **passed, 0 warnings** | spec-gap status vs. traceability ids |
| Documentation lint | `pnpm doc:lint` | **passed, 16 checks** | chapters, placeholders, links, paths, banned phrases, traceable amounts |
| Book consistency | `pnpm book:build --check` | **passed** (16 sections, 44 data placeholders, 23 figures) | build output matches chapter sources |

**Recorded but not re-run for this README**

| Item | Recorded result | Where |
| --- | --- | --- |
| Reference-implementation diff | 0 differences over 180 checkpoints | [docs/_work/diff_report.md](docs/_work/diff_report.md) |
| Traceability table | 181 rows: 131 pass / 30 partial / 0 failed / 20 pending | [docs/traceability.csv](docs/traceability.csv) |
| UI sub-case coverage | 21 sub-cases: 13 covered / 3 partial / 5 uncovered | [docs/_work/test_layers.md](docs/_work/test_layers.md) |

**Interpretation.** These results show that the implementation agrees with its rules and that the documented scenarios reproduce. They do **not** show that users need the product, understand its output, or would pay for it — no real-user study has been run.

## Documentation and deliverables

| Document | Path | What it is |
| --- | --- | --- |
| Competition project book (PDF, 58 pages) | [submission/趣有度_项目书.pdf](submission/%E8%B6%A3%E6%9C%89%E5%BA%A6_%E9%A1%B9%E7%9B%AE%E4%B9%A6.pdf) | A4 typeset proposal with 23 figures and appendices A–F |
| Chapter sources | [book/chapters/](book/chapters/) | 16 Markdown chapters; Appendix B is generated |
| Figure index | [book/figures/index.md](book/figures/index.md) | every figure with file name, data source and caveat |
| Engine status counts | [book/data/status.json](book/data/status.json) | machine-readable test and coverage counts used by the book |
| Rules (authoritative) | [docs/rules.md](docs/rules.md) | `R001`–`R020`, `D01`–`D88`, demo configuration |
| Scope and boundaries | [docs/scope.md](docs/scope.md) | what the product does and does not do |
| External source register | [docs/sources.md](docs/sources.md) | industry, statistical, competitor and competition sources with dates and limits |
| Survey method and results | [docs/_work/survey/](docs/_work/survey/) | questionnaire, schema, de-identified responses, per-question statistics, findings |
| UI coverage matrix | [docs/_work/test_layers.md](docs/_work/test_layers.md) | which layer covers which sub-case |
| Registered gaps | [docs/_work/vector_gaps.md](docs/_work/vector_gaps.md), [docs/_work/spec_gaps.md](docs/_work/spec_gaps.md) | assertions that cannot be vectors; specification gaps and rulings |
| Final QA record | [docs/_work/final_qa/QuYouDu_Final_QA_Report.md](docs/_work/final_qa/QuYouDu_Final_QA_Report.md) | pre-submission audit: version reconciliation, defect found and fixed, executed tests, unresolved items |
| Change log and checklist | [docs/_work/final_qa/QuYouDu_Final_QA_Changelog.md](docs/_work/final_qa/QuYouDu_Final_QA_Changelog.md), [docs/_work/final_qa/QuYouDu_Final_Submission_Checklist.md](docs/_work/final_qa/QuYouDu_Final_Submission_Checklist.md) | file-by-file changes; PASS/PARTIAL/BLOCKED status |
| Claim–source ledger | [docs/_work/final_qa/QuYouDu_Claim_Source_Ledger.csv](docs/_work/final_qa/QuYouDu_Claim_Source_Ledger.csv) | 51 key claims with evidence, validity range and limits |
| Screenshots | [submission/screenshots/](submission/screenshots/) | four pages, captured from the running prototype (simulated data) |

## Team

| Member | Role |
| --- | --- |
| 陈冠达 (Chen Guanda) | Team lead · product and rules |
| 张烙华 (Zhang Luohua) | Computation and testing |
| 刘博文 (Liu Bowen) | Prototype implementation |

Team name **NaiLung**, The Hong Kong Polytechnic University. Roles reflect the work recorded in this repository; no external contributors, advisors, sponsors or institutional partners are claimed.

## License and disclaimer

**License.** This repository contains no `LICENSE` file and `package.json` declares no `license` field, so no open-source license is granted. Treat the code, data and documents as competition material belonging to the team; do not redistribute without permission.

**Disclaimer.** QuYouDu is a planning and decision-support prototype. It does not provide financial, investment, credit or tax advice, does not guarantee that expected income will arrive, and does not guarantee that a plan marked feasible can actually be executed. All figures in the demo cases are simulated. Any real-world use requires the user's own verification of prices, payment dates and available funds, and — before any institutional deployment — a separate assessment of data-protection and consumer-protection obligations.

## Engineering constraints

These rules are enforced in code review and by the test suites; `AGENTS.md` states them for AI agents as well.

- Money is integer cents only; no floating-point arithmetic on amounts.
- Time comes from the simulated `as_of` clock; `Date.now()`, argument-less `new Date()` and `Math.random()` are forbidden in the engine.
- Money, dates, constraints, ranking and forecasts are computed only inside `src/engine/`. Language-layer output can only become a *pending* value.
- Protected baselines are not edited to make tests pass: `tests/golden/**`, `tests/golden.lock`, the `expect`/`source_text` fields of `fixtures/vectors/**`, and the original content of `docs/sources.md`.
- Simulated data is labelled as such in the UI and in exports; no real platform names, real prices, real user feedback or invented integrations.
- `oracle/` is an independent reference implementation: it may be executed (`python -m oracle`) for comparison but its source is not used to derive the main implementation.
