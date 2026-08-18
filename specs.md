# UI specifications

## Scope

This document describes the dashboard UI introduced for Lorica's authenticated web application. It applies to the overview, pull-request history, installation flow, and shared navigation/components.

## Design direction

Lorica uses a compact dark interface aimed at developers who need to scan review activity quickly.

- **Base:** `#0D0F14`; panels use `#141720` with `#1E2330` borders.
- **Primary action:** violet (`#7C6AF7`); it signals navigation, links, and focused controls.
- **Status:** green for completed/active, yellow for pending, and red for failed states.
- **Typography:** Inter for interface copy and JetBrains Mono for status, metadata, identifiers, and metrics.
- **Shape:** 8–16px rounded corners, subtle borders, and restrained shadows. Cards lift slightly on hover.

## Responsive layout

| Viewport | Navigation | Content behavior |
| --- | --- | --- |
| Below `lg` | Fixed bottom navigation with four icon-and-label items. | Pages include bottom padding so controls and tables remain reachable. Tables scroll horizontally rather than clipping data. |
| `lg` and above | Sticky, 224px left sidebar with account controls. | Main content grows fluidly, capped at 1152px. |

Interactive controls display a violet keyboard-focus ring. External PR links are always visible on touch-sized layouts and appear on row hover on desktop.

## Overview (`/dashboard`)

### Header

- Uses a bordered panel with a soft violet glow, page context, date, and a bot-health indicator.
- The health indicator is informational; it does not currently perform a service-health request.

### Metrics

- A responsive two-column / three-column card grid shows live data derived from stored pull requests and review jobs.
- During loading, six metric-shaped skeleton cards preserve the layout and avoid a page jump.
- The metrics are Review Findings, PRs Reviewed, Average Review Time, Issues Caught, Clean Review Rate, and Repositories.

### Activity panels

- Recent PRs show the latest five stored records and link to the full history.
- Activity shows the six latest review events.
- Empty states explain the next action instead of rendering a blank panel.
- API errors use a dedicated red alert without hiding any previously loaded data.

## Pull-request history (`/dashboard/pulls`)

- The heading identifies the page as review history and includes a refresh control.
- Refresh disables while loading and spins its icon to acknowledge the request.
- A failed request displays a visible error panel with a retry action.
- Rows display repository, PR metadata, finding count, review status, review time, and a GitHub link.

## Installation (`/dashboard/install`)

- The repository list is sourced from the logged-in user's recorded Lorica activity, not static example data.
- The workflow is presented as three numbered, connected steps: install, verify webhook processing, and optional repository configuration.
- The GitHub App link opens in a separate tab and uses the configured app slug.

## Data and state rules

- UI data is loaded from the authenticated internal `/api/pulls` route.
- Loading, empty, error, and populated states are all represented for dashboard data views.
- The UI does not display invented review statistics; unavailable durations and rates use `—`.
- Status mappings are `completed → reviewed`, `pending/processing → pending`, and `failed → failed`.

## Accessibility requirements

- All icon-only actions have an accessible label.
- Keyboard focus remains visible on links, buttons, and form controls.
- Status labels use text in addition to color.
- Bottom navigation controls meet a minimum 48px tall touch target.
