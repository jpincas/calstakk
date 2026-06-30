# UI Design Reference

Compiled from screenshot research across 6 apps. Screenshots live in subdirectories alongside this file.
Agents: read this doc first — only look at the screenshots if you need detail beyond what's here.

---

## Things 3 (Cultured Code)

**Screenshots:** `things3/` — 8 files covering sidebar, today view, project view, expanded task, search, date/time pickers, upcoming view.

### Layout
- Two-panel: narrow sidebar (left) + main content (right). No explicit panel divider — background colour is the only separator.
- Sidebar: white bg, system font, coloured icons per item (Inbox=blue, Today=yellow star, Upcoming=red calendar, Anytime=green stacked layers, Someday=grey, Logbook=green checkmark). Count badges in red.
- Below system views: Areas with nested Projects, each with a pie-chart progress icon.

### Task rows
- Square rounded checkbox (outline only, no fill) | task name (~17px, dark `~#1A1A1A`) | grey project subtitle below
- No dividers between rows — separation by vertical padding only
- Inline indicators: small doc icon for notes, checklist icon for sub-tasks, shown to right of title
- Priority: yellow star inline before task name
- Date badge: small grey rounded pill (e.g. `May 25`) inline in row
- Tags: outlined pill capsules, grey border/text, inline with task name

### Section headings (within a project)
- Bold blue text (`~#007AFF`) + full-width hairline separator line beneath
- `...` menu right-aligned on heading row

### Today view
- Yellow star heading
- Calendar events block at top (light grey rounded-rect)
- Task list below
- `This Evening` divider: moon icon, bold text, grey rule

### Expanded task (card)
- White floating card, drop shadow
- Notes text block
- Sub-checklist: blue circle `O` checkboxes (not the square style used for top-level tasks)
- Bottom action bar: calendar / tag / flag icons

### Date/time pickers
- Dark near-black modal (`~#1A1A1A` bg)
- Blue highlighted row for selected option
- Natural language results: `in 3 days — Sun`, `in 3 weeks — Thu Jun 8`

### Quick Find (search)
- Light overlay, rounded search field
- Mixed project + task results with pie-chart icons and checkboxes

### Colour palette
- Background: `#FFFFFF` main, `~#F5F5F5` for blocks
- Headings/accents: `~#007AFF` blue
- Primary text: `~#1A1A1A`
- Secondary text: `~#8E8E93` grey
- Today star: yellow
- Picker modals: near-black

### Typography
- Font: SF Pro (system font on Mac)
- Task title: ~17px, regular weight
- Project subtitle: ~13px, medium grey
- Section headings: large, bold, blue

---

## Apple Calendar (macOS)

**Screenshots:** `apple-calendar/` — 7 files covering week view, day view, event info popup, account dialog, invite panel, month view with event list.

### Window chrome
- Standard macOS window (traffic lights)
- Toolbar: `+` add button + segmented control `Day | Week | Month | Year` (pill, selected tab = white bg) + search icon
- Below toolbar: large bold date heading (`April 2025`, month in very large bold, year normal weight), left-aligned. `< Today >` nav controls right.

### Sidebar (calendar list)
- ~200px wide
- Section headers in grey caps: `iCloud`, `Other`
- Each calendar: coloured filled-square checkbox + calendar name
- Colours: blue, red, green, yellow, purple — one per calendar
- Sharing icon (person silhouette) at row right for shared calendars
- Bottom: mini month calendar embedded

### Mini calendar
- `< April 2025 >` with arrows
- S M T W T F S columns, small date numbers
- Today: red filled circle with white number
- Adjacent-month dates: lighter grey

### Week/day grid
- Column headers: short day name + date number (e.g. `Sun 30`); today circled in red
- All-day row at top
- Time gutter: hour labels in small grey text, left of grid
- Current time: red circle + red horizontal line across grid
- Events: rounded-rect blocks, coloured left border + ~15–20% opacity fill of same hue; text coloured to match
- Recurring events: circular-arrows icon inline

### Month view
- 7-column grid (S–Sa)
- Today circled in red
- Events as small coloured pill with truncated title + time
- `x more` overflow in grey
- Full-day / holiday events: pale colour band spanning full cell width

### Event info popup
- Floating rounded card with backdrop blur
- X close top-left, `Info` header
- Large bold title (supports emoji), calendar colour dot + dropdown selector top-right
- Location / Video Call field
- Date/time line, Repeat line, Alert line
- Invitees: `? Name` per person (? = awaiting response), `+ Add Invitees` field
- Notes/URL/Attachments textarea at bottom
- Footer: `Show | Revert | Send` pill buttons (grey bordered)

### Day view edit panel
- Slides in from right, ~350px wide
- Sections: title, Notes, URL, Date & Time, Repeat, Early Reminder, Organization
- iOS-style toggle switches for Date and Time fields
- Light grey grouped-section backgrounds with dividers
- Label left, control right (standard macOS form layout)

### Account provider dialog
- Standard macOS sheet
- Radio list: iCloud, Microsoft Exchange, Google, yahoo!, Aol., **Other CalDAV Account…** (catch-all for custom servers like CalStakk)
- `Cancel | Continue` bottom right

### Colour palette
- Background: white / `~#F5F5F7`
- Red accent: `#FF3B30` — today indicator, current-time line, app icon
- Event colours: macOS system palette (blue, green, red/pink, orange, yellow, purple, grey)
- Event fill: ~15–20% opacity of calendar colour; border/text at 100% saturation
- Grid lines: light grey

### Typography
- Font: San Francisco (SF Pro)
- Month/year heading: ~28–32px bold
- Day column headers: ~13px medium
- Event titles in blocks: ~12–13px medium
- Time labels: ~11–12px grey
- Info panel title: ~24px bold

---

## Google Calendar (web)

**Screenshots:** `google-calendar/` — 13 files. Notable: `01-official-light-mode.png` (best overall week view), `07-week-view-custom.jpg` (sidebar + mini calendar), `11-task-creation.gif`, `12-task-list-sidebar.gif`.

### Layout
Three-column shell:
- **Left sidebar** (~200px): hamburger + `Calendar` wordmark + `Create` button, mini calendar, `Search for people` field, calendar list (My calendars / Other calendars, coloured checkbox per calendar)
- **Right thin rail** (~40px): Tasks panel icon, Maps, People
- **Main grid**: remainder

Top bar: hamburger, Google Calendar logo (blue `31` icon), `Today` pill, prev/next arrows, current period label, search, settings, view picker.

### Week view grid
- Column headers: abbreviated day name (small caps, light grey) + date number; today = filled blue circle behind number
- Time axis: left of grid, `7 AM` etc. in small grey; timezone label above (`GMT+01`)
- All-day row at top: spanning event blocks, rounded corners
- Hour cells: thin horizontal hairlines; today column has very subtle light-blue tint
- Current time: red dot on axis + red horizontal line across active column
- Events: rounded-rect chips, colour-coded; name + time on separate lines for taller events; small events truncate to one line

### Mini calendar (left panel)
- 7-column, ~160px wide; day-of-week single letters (M T W T F S S)
- Today: blue filled circle on date number
- Selected week: entire row subtly highlighted (light blue bg)
- Prev/next arrows alongside month/year label

### Event creation popover
- White floating card, rounded corners (~12px), subtle drop shadow
- `Add title` large placeholder with underline input (no box border)
- Event type tabs: `Event | Focus time | Out of office | Working location | Task | Appointment schedule` — pill tab row, selected = light blue fill
- Form rows: icon + text label, no explicit input borders (ghost/flat style):
  - Clock: date + time range
  - People: `Add guests`
  - Meet icon: `Add Google Meet video conferencing`
  - Map pin: `Add rooms or location`
  - Lines: `Add description or attachments`
  - Calendar: owner + `Busy · Default visibility · Notify 10 minutes before`
- Footer: `More options` text link left, `Save` filled blue pill right

### Tasks side panel
- Slides in from right rail; shows task list alongside week grid
- Task creation via same Create dialog with Task tab selected

### Colour palette — light mode
- Background: `#ffffff` main grid; sidebar/topbar: light blue-grey wash (`~#f0f4ff`)
- Today circle: `#1a73e8` (Google Blue)
- Current time line: `~#d93025` red
- Save button: `#1a73e8`, fully rounded pill
- Event colours: user-selectable; defaults include teal, blue, green, cyan
- Calendar checkboxes: coloured squares matching calendar colour

### Colour palette — dark mode
- Background: `~#202124` near-black
- Surface cards: slightly lighter dark grey
- Text: white / light grey
- Same event hues, slightly desaturated

### Typography
- Font: Google Sans / Product Sans
- Month/year heading: ~22–24px, normal weight
- Mini calendar numbers: ~12–13px
- Event chips: ~11–12px, truncated with ellipsis
- Form fields: ~14–16px placeholder, lighter grey
- Time labels: ~11px grey, right-aligned

### Material Design 3 tokens
- Fully rounded pill buttons (Today, Save)
- Rounded-rect event chips
- No hard borders between sections; background colour wash separates sidebar from grid
- Subtle elevation/shadow on quick-create popover
- Icon family: Material Symbols, outlined, consistent stroke weight

---

## Trello

**Screenshots:** `trello/` — 29 files covering board view, card back modal, dark mode, table view, calendar view, filters, labels, card covers, and more.

### Global header
- White bg, 1px bottom border, low visual weight
- Logo + hamburger left; full-width search bar centre; `Create` button (Atlassian blue `~#0052CC`); notification bell, help, settings, avatar right

### Board sub-header
- Board name + view switcher dropdown left
- Member avatars, Power-Ups, Automation, Filter, Star, Lock, Share, `...` right
- Filter button shows count badge when active + `Clear all` link

### Left sidebar
- Workspace name + member count at top
- Collapsible sections: `Workspace views` (table, timeline etc.), `Your boards` list with thumbnail previews
- Can collapse to icon-only rail with `<<` chevron

### Lists (columns)
- Fixed width ~272px
- White rounded containers (~12px radius), slight box-shadow, no coloured border
- Header: bold list name (~14px, dark navy, 600 weight) + `…` overflow menu; count badge when filtered
- `+ Add a card` at bottom expands to inline textarea

### Cards
- White, ~8px radius, subtle shadow
- Optional coloured cover strip at top (or full-height image cover)
- Label pills row (coloured capsules, ~16px tall, text or colour-only swatch mode)
- Card title: dark navy `~#172B4D`, ~14px, regular weight
- Bottom metadata row: description icon | comment count | attachment count | checklist progress (`☑ 0/15`) | due date chip | member avatars (right-aligned, overlapping circles)
- Hover: pencil quick-edit icon top-right corner

### Due date chip
State-coloured pill with clock icon:
- Default: grey
- Due soon: yellow `~#F5A623` bg fill
- Overdue: red bg fill
- Complete: green bg fill with checkmark

### Card back (detail modal) — 2025 redesign
- White modal, centred, ~660px wide, rounded corners, board blurred behind
- Top bar: list name dropdown | megaphone icon | cover icon | `...` actions | `×` close
- Title: circle completion checkbox + large editable card title
- Action tabs: `+ Add | Labels | Dates | Checklist | Members | Attachment` — outlined pill buttons
- Metadata row: Members (avatars + `+`) | Labels (swatches + `+`) | Due date (text + state badge)
- Description: markdown rendered, `Edit` ghost button
- Checklist: section header + Delete button + progress bar (`0%`) + items with checkboxes + `Add an item`
- Comments: `Write a comment...` input
- Bottom floating toolbar (external to modal): bookmark/watch | automation | comment — 3-icon pill

### Label system
- 10 colours in 5×2 grid: green, yellow, orange, red/salmon, purple / teal/sky, cyan, mint-green, pink/hot-pink, navy
- Rounded square swatches ~32px
- Text mode toggle: shows white text on colour fill

### Dark mode
- Board: `#1D2125`
- Lists: `#282E33`
- Cards: `#22272B`
- Same label hue/shape, vibrant against dark card surface

### Colour palette — light mode
- Board: user-chosen photo/gradient
- Lists + cards: white
- Dark navy text: `~#172B4D`
- Primary CTA: `~#0052CC` Atlassian blue

### Typography
- Font: Charlie Sans (Atlassian's own typeface), geometric humanist
- Card title in list: ~14–15px, normal weight
- Card title in modal: ~18–20px
- List header: ~14px bold (600)
- Metadata labels: ~12px

### Views beyond board
- **Table view**: spreadsheet rows — Card, List, Labels, Members, Due date columns; labels as pills in Labels column
- **Calendar view**: monthly grid, cards placed on due-date cells, `+ Add` in date cell

---

## GitHub Projects

**Screenshots:** `github-projects/` — 19 files covering table, board, roadmap, issue detail side panel, filters, sort, field editors, and more.

### Chrome
- Global nav: solid black (`#0d1117`), white text, GitHub octicon logo, breadcrumb, search, `+`, notification bell, avatar
- Project title bar: white bg, project name bold ~20px + lock + project-type icon; top-right: chart, layout-toggle, `...`; green status badge (`On track` = `#2da44e`)

### View tabs
- Horizontal scrollable tab row, ~36px tall
- Each tab: layout-type icon + label; active tab = white bg, slightly heavier font
- `+ New View` button at end

### Filter bar
- Full-width text input, ~36px, left-padded funnel icon
- Structured filter syntax: `has:sub-issues-progress is:open`, `cycle:@current`
- Filter tokens render as blue hyperlinks inline
- Right: count badge (grey pill) + X + `Discard` / `Save` (green filled `#2da44e`)

### Table view
- Row number gutter (light grey) + columns with thin vertical dividers
- Column headers: 13px medium grey, `...` context menu on hover
- Group header rows: collapsible (`▾`), bold name, item count badge, aggregate pill, status indicator
- Data rows: ~40px tall, 1px bottom border `~#f0f0f0`
- Issue status icons: open = green circle with dot; closed = purple circle with checkmark; draft = dashed circle
- Title column: issue title (normal weight) + issue number `#802` in grey
- Field chips (Status, Priority, Type): coloured pill badges ~22px, rounded-full, icon/emoji + label:
  - `Planning` yellow/amber | `Review` orange | `Building` teal | `Triage` grey | `Not Started` grey
  - `Urgent` red-orange | `High` amber/gold | `Medium` yellow | `Low` light blue
  - `Task`, `Epic`, `Bug`, `Initiative` — different pastel fills
- Progress bar: thin purple filled + `50%` text + `1/2` fraction
- Assignees: circular avatar 20px + username
- Dropdown `▾` appears on hover in every cell for inline editing
- `+ Add item` at bottom of each group

### Board/kanban view
- Column width ~280–320px, full-height, off-white `#f6f8fa` column bg
- Column header: bold status label + status icon + fraction `6/5` + `Estimate: X` grey pill + `...` menu
- Cards: white bg, 1px border `#d0d7de`, ~6px radius, ~12px padding, subtle box-shadow
  - Top: repo + issue number in small grey, avatar floated right
  - Middle: title ~14px, wraps 2–3 lines
  - Bottom: label chips (coloured, rounded-full, ~18px) + linked PR number
- `+ Add item` at column footer

### Roadmap view
- Split: left sidebar (~520px) = table of items; right = horizontal calendar timeline
- Gantt bars: rounded-rect, 1px border, white fill with grey border; status icon + title + avatar inside
- Marker lines: vertical dashed/dotted line (red or green) with label pill
- Today line: subtle red vertical line
- Top-right controls: `Markers`, `Cycle`, `Date fields`, zoom (`Quarter`/`Month`), `Today`, `< >` arrows

### Issue detail side panel
- Slides in from right, project list dims behind it
- Full GitHub issue experience: breadcrumb, title + number ~22px bold, `Open` green pill, opener avatar + timestamp
- Body: markdown-rendered
- Right metadata rail (~240px): Assignees, Labels, Projects, Milestones, Relations, Development, Notifications, Participants
- Labels: coloured rounded pills

### Colour palette — light mode
- Page bg: `#ffffff` panels on `#f6f8fa` chrome/sidebar
- Borders: `#d0d7de`
- Text primary: `#1f2328`
- Text secondary: `#656d76`
- Green (open/success): `#2da44e` / `#1a7f37`
- Purple (closed): `#8250df`
- Red (off-track): `#cf222e`
- Amber/yellow (at-risk, medium priority): `#9a6700`
- Link blue: `#0969da`
- Chip fills: washed-out tints of above

### Colour palette — dark mode
- Global nav: `#161b22`
- Content bg: `#0d1117`
- Panel bg: `#161b22`
- Text primary: `#e6edf3`; secondary: `#7d8590`
- Borders: `#30363d`
- Same semantic colours (green/red/amber) adjusted for contrast

### Typography
- Font: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial` — no custom typeface
- Sizes: ~13px metadata, ~14px body rows, ~16px column headers, ~20–22px project title, ~13px chips
- Weight: 400 data, 600 group headers/titles, 700 sparingly

---

## Linear

**Screenshots:** `linear/` — 30 files. Best overall views: `04-sidebar-after.png`, `06-issue-list-after.png`, `14-issue-panel-after.png`, `21-latest-refresh-hero.png`, `23-latest-refresh-board.png`, `24-latest-refresh-sidebar.png`.

### Layout architecture (formally defined by Linear team)
```
01: APP          — window chrome (macOS traffic lights, back/forward)
02: LOCATION BAR — breadcrumb + global actions (bell, history, compose)
03: VIEW BAR     — per-view controls (filter, display, entity pill buttons)
04: CONTENT      — the actual list/board/detail
```

Three-pane content split:
- Left: sidebar (~200px, fixed)
- Centre: issue list / inbox (~220–260px)
- Right: issue detail + properties (fills remaining, min ~600px)

No explicit borders between panes — only the background colour step communicates boundaries. Feels like one unified surface.

### Left sidebar structure
1. Header: workspace icon (~20px) + `Linear` text + dropdown `▾` | right: search icon + compose-new-issue button (rounded square, `#252530` fill)
2. Personal group (no label): Inbox (unread count badge), My issues
3. `Workspace` section (collapsible): Views, Roadmaps, Teams
4. `Favorites` section (collapsible): pinned items with coloured project icons
5. `Your teams` section (collapsible): team name + icon, expands to Issues > Active/Backlog | Projects | Views
6. Bottom: Help `?` button

Item row height: ~28–32px. Font: ~12–13px. Active/selected item: low-contrast rounded-rect fill (`#252530`) — very restrained.
Section header labels (Workspace, Favorites) are tiny, muted, with collapse triangle.

### Issue list / inbox rows
```
[24px avatar] [Issue title — medium ~13px] [status icon ~16px] [timestamp right ~11px muted]
              [Action description — muted ~12px, one line]
```
- No horizontal divider lines — separation by vertical padding only
- Row height: ~44–48px with avatar
- Selected row: background highlight
- Timestamps right-aligned in muted secondary: `1 day`, `3d`, `1w`

### Status icons (circular, ~16px)
- Todo: empty ring
- In Progress: dotted/partial ring
- Done: solid circle with checkmark
- Cancelled: solid circle with slash

No colour required to read state — the shape communicates it.

### Issue detail panel
- Parent issue chip at top: `[status dot] [issue ID] [title] [sub-issue count]` — pill shape, muted bg
- Issue title: ~20–22px, semibold, near-white, generous line height
- Description: `Add description...` placeholder in tertiary grey
- Sub-issues collapsible section with `+ add` and `...` buttons
- Activity: avatar + author + timestamp, comment text below in slightly lighter bg card

### Right properties sidebar (~240px)
- `[label] [value]` 2-column layout
- Properties: Status, Priority, Assignee, Estimate, Labels, Cycle, Project, Milestone
- Values are interactive but show no form controls at rest — just clickable text/badge
- Labels: small coloured dot + label name
- Cycle: cycling-arrows icon in indigo
- Milestone: diamond icon in orange-red

### Tab bar (progressive disclosure)
- Inactive tabs: icon-only pill (~28×28px), just the project emoji/icon
- Active tab: expands to wider pill with icon + full name text
- Pinned context items shown as pills to the right of active tab
- `+` at far right to open additional tabs

### View bar / filter controls
- View mode toggles: bar-chart icon | board-grid icon (icon+text, no border, muted)
- Grouping tabs: `Labels | Priority | Projects | Teams` — pill tabs, active = white/near-white bg
- Each group row: `[colour dot] [label name]` | right: `[warning icon] [count]`

### Colour palette — dark mode (primary designed experience)
Backgrounds (layered, no borders between them):
- App chrome / deepest: `~#0E0E11` (warm near-black, not cold blue-black)
- Sidebar: `#141418`
- Main content: `#18181C`
- Card / hover surface: `#1E1E24`
- Active/selected row: `#22222C` (very subtle blue tint)
- Modal overlay: `~#111116` + transparency

Text:
- Primary: `rgba(255,255,255,0.9)` — near-white, not harsh pure white
- Secondary: `~#8B8B9A` muted cool grey-purple
- Tertiary / placeholder: `#555565`
- Section headers: `~#4A4A58`

Accents:
- Primary accent (links, active tab, Done status): `~#5865F2` periwinkle indigo
- In-progress / amber: `#E8A246`
- Done / green: `#3DA870` (slightly muted, not neon)
- Urgent / red: `~#E35E5E` (used sparingly)

### Colour palette — light mode
- Background: `#F0F0F3` warm off-white (not pure white)
- Sidebar: `#E8E8EC` (slightly darker)
- Selected item: `#FFFFFF` card with faint box-shadow, floats above the grey
- Text primary: `#111115`, secondary: `#8A8A94`

### Dark mode design principles
1. Warm-grey base (not cold blue-black) — intentional, not a default dark mode
2. Layered bg steps — sidebar/content/card/hover all distinct within a 10–15 lightness point range; no borders needed
3. Status colours desaturated — identifiable but don't fight each other
4. Pure white avoided for text — `rgba(255,255,255,0.9)` gives softness
5. Very subtle gradient in content area (near-black → slightly lighter navy), sidebar stays flat
6. Mobile: true `#000000` for OLED

### Typography
- Font: Inter throughout
- Sidebar nav: ~12–13px, regular inactive, 500 medium active
- Issue list titles: ~13–14px, medium weight
- Issue detail title: ~20–22px, semibold (600)
- Secondary/metadata: ~11–12px, regular
- Section headers: ~10–11px, possibly letter-spaced, muted
- Line heights: tight ~1.3–1.4× (dense UI, not document-style)

### Density
- Sidebar item rows: 28–32px height
- Inbox rows: 44–48px (includes avatar)
- Properties panel rows: ~32px
- Horizontal padding sidebar items: ~12px left, ~8px right
- Border radius: chips/pills ~6–8px, app window 10px (macOS standard), modals ~12px
- No decorative borders
