# Habit Tracker

A personal habit tracker that visualises consistency as GitHub-style contribution heatmaps: one heatmap per habit, plus an aggregate heatmap across all of them.

## Language

### Core

**Habit**:
A recurring commitment the user intends to honour on some schedule. The unit everything else hangs off.
_Avoid_: Hobby, task, goal, activity

**Cadence**:
The schedule that determines which days a Habit is expected on. One of: every day, a fixed set of weekdays, or N times per week. Effective-dated — changing a Cadence never re-scores history, which is judged against the Cadence in force at the time.
_Avoid_: Frequency, repeat, recurrence

**Scheduled Day**:
A Day on which a Habit is expected, per its Cadence. Days that are not Scheduled Days can never be a Miss and never break a Streak.
_Avoid_: Due date, active day

**Completion**:
A record that a Habit was honoured on a given Day. Binary — a Habit is either completed that Day or it is not. There is no partial completion.
_Avoid_: Entry, log, check-in, tick

**Miss**:
A Scheduled Day that has passed with no Completion and no Freeze. Distinct from a Day that was simply never scheduled or fell outside the Habit's tracked range. Habits with a weekly quota have no daily Misses — their failures are recorded per week, not per Day.
_Avoid_: Fail, skip, break

**Weight**:
How much a Habit counts toward the Aggregate Heatmap: Minor, Core, or Unskippable. Effective-dated alongside Cadence, so changing it never re-scores history.
_Avoid_: Priority, importance, difficulty, points

### Time

**Day**:
A human calendar day in the user's local reckoning, identified by a plain date with no time or timezone attached. The boundary between one Day and the next is the Day Start, not midnight.
_Avoid_: Date, timestamp, 24-hour period

**Day Start**:
The wall-clock time at which a new Day begins for logging purposes, defaulting to 04:00. Activity before the Day Start belongs to the previous Day.
_Avoid_: Cutoff, rollover, reset time

**Start Date**:
The first Day on which a Habit is tracked. Days before it are outside the Habit's range entirely and are excluded from every statistic.
_Avoid_: Created date, begin date

### Protection

**Freeze**:
The act of spending a Freeze Token to keep a Streak alive across a Scheduled Day the Habit was not completed. Has its own Cell state, is never rendered or counted as a Completion, and never contributes to completion rate.
_Avoid_: Skip, pass, rest day, excuse, streak save

**Freeze Token**:
The allowance that a Freeze spends. One is granted per Habit per calendar month and expires at month end unless that month was Flawless, in which case it carries over, up to a bank of three. A Freeze may only be applied to a Day within the last seven Days.
_Avoid_: Life, credit, pass, token

**Flawless Month**:
A calendar month in which a Habit was active throughout and every Scheduled Day was completed, with no Misses and no Freezes. Scoped to one Habit over a month, unlike a Perfect Day, which spans all Habits over one Day.
_Avoid_: Perfect month, clean month, full month

### Progress

**Streak**:
An unbroken run of Completions across consecutive Scheduled Days for one Habit. Counted over Scheduled Days, never over calendar days.
_Avoid_: Run, chain, combo

**Golden Streak**:
A Streak that has reached the gold threshold. Every Completion in the run is rendered gold rather than the Habit's own Colour, and stays gold permanently once earned — breaking the Streak does not revoke it. The threshold is cadence-relative: consecutive Completions for daily and weekday Habits, consecutive quota-meeting weeks for weekly ones.
_Avoid_: Achievement, badge, reward, trophy

**Colour**:
The single hue chosen for a Habit from the Palette, used to render its Completions. A Habit's heatmap is two-tone: its Colour where completed, neutral where not.
_Avoid_: Theme, style

**Palette**:
The fixed set of Colours a Habit may be assigned. Gold, neutral grey, and the Aggregate Heatmap's own hue are reserved and cannot be claimed by a Habit.
_Avoid_: Colour picker, swatches, theme

### Visualisation

**Cell**:
One square in a heatmap, representing one Habit on one Day. A Cell is in exactly one state: completed, frozen, missed, unscheduled, or out-of-range — the last covering Days before the Start Date, Days on or after an Archive, and future Days alike.
_Avoid_: Square, box, tile, dot

**Habit Heatmap**:
The calendar grid for a single Habit, showing its Cells across a chosen range — a month, a quarter, or a year.
_Avoid_: Individual heatmap, per-habit chart

**Aggregate Heatmap**:
The single grid summarising all Habits at once, where a Day's intensity reflects how much of that Day's expected work was completed. The only heatmap with graduated shading.
_Avoid_: General heatmap, overall heatmap, master heatmap, combined view

**Perfect Day**:
A Day on which every Habit scheduled for it was completed. Rendered distinctly on the Aggregate Heatmap, above the ordinary top intensity band.
_Avoid_: Full day, 100% day, clean sweep

### Lifecycle

**Archive**:
To retire a Habit while preserving its history: it stops accruing Misses from the archive point and leaves the dashboard, and it can be restored. Pausing a Habit is an Archive followed later by a restore, not a separate concept.
_Avoid_: Pause, disable, deactivate, hide

**Delete**:
To destroy a Habit and its entire Completion history irreversibly. Distinct from Archive.
_Avoid_: Remove, clear

### Annotation

**Note**:
Optional free text attached to a single Completion, recording something about that particular Day.
_Avoid_: Comment, journal, description
