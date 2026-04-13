# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

A single-page web experiment for first-year behavioral science students (Licenciatura en Ciencias del Comportamiento, UTDT). Students do 10 practice trials, then run a **two-armed bandit task** (80 trials, two phases) and see their individual and group learning curves at the end. Built by Guillermo Solovey for the course **NyPE** (Neurociencia y Psicología Experimental).

Deployed to **GitHub Pages** — no build step, pure static files.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Main experiment — 7 screens: welcome, practice-intro, task (shared), practice-debrief, individual results, collective results + leaderboard, learn more |
| `styles.css` | Shared styles — dark theme, CSS variables, mobile-first. Includes leaderboard component. Used by both `index.html` and `admin.html` |
| `app.js` | All experiment logic: state, reward randomization, Supabase saves, Chart.js rendering, leaderboard |
| `admin.html` | Teacher dashboard — no password, collective learning curve + stats + leaderboard + adjustable window size |

## Experiment design

### Practice (10 trials)
- Fixed 70/30 probabilities, no reversal
- Which option is the winner is randomized 50/50 per session (independent of the real experiment's `phase1Winner`)
- **Not saved to Supabase**
- After practice: debrief screen shows which machine paid more and how many times the participant chose it (dynamic X/Y)
- Then a transition message explains the real experiment starts and that probabilities may change without warning

### Real experiment (80 trials)
- **Phase 1** (trials 1–40): one option rewards 70%, the other 30%
- **Phase 2** (trials 41–80): probabilities reverse — the previously bad option is now good
- The reversal is **not announced** — participants discover it (or don't)
- Which option (A or B) is the phase-1 winner is **randomized per session** (50/50), independently of the practice winner
- Learning curve Y-axis: **% chose the optimal option** (not % chose A), making all sessions comparable regardless of randomization

### Shared task screen
The same `screen-task` is reused for both practice and real experiment. `state.isPractice` controls the logic. The task header shows a "PRÁCTICA" badge and "/ 10" or "/ 80" trial counter depending on mode.

## Stack

- Vanilla JS (ES6+), no framework, no build step
- [Chart.js 4.4.1](https://cdn.jsdelivr.net/npm/chart.js@4.4.1) via CDN
- [Supabase JS v2](https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2) via CDN
- Google Fonts: Playfair Display (headings/numbers), DM Mono (labels/code), DM Sans (body)
- Supabase credentials inlined in HTML (anon/publishable key — safe for frontend)

## Design system

Matches the aesthetic of the NyPE Stroop app (`gsolovey-utdt/stroop`):
- Dark background `#0d0e12`, surface `#161820`
- Gold accent `#e8c547` (primary actions, scores, option A button, leaderboard #1)
- Blue accent `#5b8dee` (option B button, probability reference line)
- Silver `#a0a8c0` / Bronze `#cd7f32` for leaderboard ranks 2 and 3
- NyPE badge on all screens except the task screen

## Supabase table: `trials`

```sql
create table trials (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null,
  participant_name text not null,
  trial_number integer not null,
  phase integer not null,
  choice text not null check (choice in ('A', 'B')),
  phase1_winner text not null check (phase1_winner in ('A', 'B')),
  rewarded boolean not null,
  cumulative_score integer not null,
  reaction_time_ms integer not null,
  created_at timestamptz default now()
);
alter table trials enable row level security;
create policy "anon_insert" on trials for insert to anon with check (true);
create policy "anon_select" on trials for select to anon using (true);
```

Collective results and leaderboard filter to sessions with ≥ 80 trials (complete sessions only). The query paginates in pages of 1000 rows to avoid Supabase's default row limit.

## Admin panel (`admin.html`)

- No password — open directly
- Stats: total complete sessions, average score
- Chart: individual session curves (faint gold) + group average (bright gold) + 70% reference line (blue dashed) + vertical line at reversal (trial 40.5)
- Window size selector (1–20 trials, default 5) — changes smoothing without re-fetching data
- Leaderboard: top 10 by final score, medals for top 3
- Refresh button to reload live during class

## Main app leaderboard

Appears on the collective results screen (screen 4) below the chart. Same top-10 format. Fetched from Supabase alongside the collective curve data.

## Keyboard shortcuts (task screen)

- `←` arrow = choose option A
- `→` arrow = choose option B

## Deploy

Hosted on GitHub Pages. Push to `main` and Pages serves from repo root. No build needed.
