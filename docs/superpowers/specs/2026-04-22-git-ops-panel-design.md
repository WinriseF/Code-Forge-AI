# Git Operations Panel — Design Spec

## Overview

A floating Command Palette–style panel for Git operations, triggered from the commit graph header. Designed for extensibility — the first version implements branch switching, with a clear path for adding stash management, commit, merge, and other Git operations later.

**First version scope:** Branch listing, search, and switching (with auto-stash for dirty worktrees).

---

## Architecture

### Principle: Separation by Domain

The existing `useGitGraphStore` (commits, diffs, exports) and `commands.rs` (760 lines, all-in-one) are left untouched. New functionality lives in dedicated modules and stores.

```
Backend (Rust)                     Frontend (TypeScript)
─────────────────                  ──────────────────────
commands.rs    (existing)          useGitGraphStore.ts (existing)
branch.rs      (NEW)               useGitOpsStore.ts   (NEW)
models.rs      (+branch types)     GitOpsPanel.tsx     (NEW)
error.rs       (+branch errors)    CommitGraphPanel.tsx (minor edit)
lib.rs         (register cmds)     patch_types.ts      (+types)
```

**New files:** 2 backend + 1 store + 1 component = 4 new files
**Modified files:** 4 minor edits (lib.rs, models.rs, error.rs, CommitGraphPanel.tsx)

---

## Backend API

### Commands

Three new Tauri commands, all in `branch.rs`:

#### `get_git_repo_overview(project_path: String) -> Result<GitRepoOverview>`

Lightweight status snapshot. Called once when the panel opens and after any branch operation.

Returns:
- Current branch name (or `None` for detached HEAD)
- HEAD hash (full + short)
- Upstream branch name
- Ahead/behind counts
- Worktree status flags: `has_staged`, `has_unstaged`, `has_untracked`, `conflicted_count`
- Stash count

This replaces the need for a separate `preflight_switch_branch` command — the frontend reads worktree status from the overview and decides which UI flow to show.

#### `list_git_branches(project_path: String, include_remote: Option<bool>, query: Option<String>) -> Result<Vec<GitBranchSummary>>`

Lists local and optionally remote branches. Supports search filtering.

Each entry includes:
- `name`, `full_refname`
- `is_current`, `is_remote`
- `upstream_name`, `ahead`, `behind` (local branches only)
- `head_hash`, `head_short_hash`
- `last_commit_message`, `last_commit_date`

Sort order: current branch first, then local alphabetically, then remote alphabetically.

Remote branches ending in `/HEAD` are filtered out.

#### `switch_branch(project_path: String, target_branch: String, options: SwitchBranchOptions) -> Result<SwitchBranchResult>`

**Atomic operation.** Handles the full switch lifecycle in one call:

1. Verify target branch exists (local or remote)
2. Check worktree status
3. If worktree is dirty AND `stash_if_dirty == true` → stash changes (with optional message)
4. If worktree is dirty AND `stash_if_dirty == false` → return `DirtyWorktree` error
5. If conflicts exist → return `Conflicts` error (always blocked, regardless of stash option)
6. If target is remote-only AND `create_tracking == true` → create local tracking branch
7. Checkout target branch
8. Return result with `stash_created` flag and `current_branch`

The frontend never needs to call preflight separately for the switch flow. The cached `GitRepoOverview` tells the UI whether to show the stash confirmation, and the backend re-validates during execution.

### Data Models

```rust
// models.rs — additions

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitRepoOverview {
    pub current_branch: Option<String>,
    pub is_detached_head: bool,
    pub head_hash: Option<String>,
    pub head_short_hash: Option<String>,
    pub upstream_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub has_staged_changes: bool,
    pub has_unstaged_changes: bool,
    pub has_untracked_files: bool,
    pub conflicted_count: usize,
    pub stash_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitBranchSummary {
    pub name: String,
    pub full_refname: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream_name: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub head_hash: String,
    pub head_short_hash: String,
    pub last_commit_message: String,
    pub last_commit_date: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SwitchBranchOptions {
    pub stash_if_dirty: bool,
    pub stash_message: Option<String>,
    pub create_tracking: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SwitchBranchResult {
    pub success: bool,
    pub current_branch: String,
    pub previous_branch: Option<String>,
    pub stash_created: bool,
    pub warning: Option<String>,
}
```

### Error Variants

```rust
// error.rs — additions

#[error("Working tree has uncommitted changes")]
DirtyWorktree,

#[error("Branch not found: {0}")]
BranchNotFound(String),

#[error("Unresolved conflicts prevent this operation")]
UnresolvedConflicts,

#[error("Stash failed: {0}")]
StashFailed(String),
```

### Helper Functions (in `branch.rs`)

Private helpers, not exposed as commands:

- `format_commit_time(Time) -> String` — placed in `branch.rs` as `pub(crate)`, `commands.rs` updated to call `crate::branch::format_commit_time` instead of its local copy (removes one of two duplicates)
- `current_branch_name(&Repository) -> Option<String>`
- `shorten_hash(&str) -> String`
- `collect_worktree_status(&Repository) -> WorktreeStatusSummary`
- `count_stashes(&mut Repository) -> usize`
- `branch_ahead_behind(&Repository, &Branch) -> (usize, usize, Option<String>)`
- `checkout_branch(&Repository, branch_name: &str) -> Result<()>`
- `create_tracking_branch(&Repository, remote_branch: &str) -> Result<String>`

`format_commit_time` is currently duplicated in two places within `commands.rs`. This change moves it to `branch.rs` as `pub(crate)` and updates `commands.rs` to call `crate::branch::format_commit_time`, removing the duplication.

---

## Frontend Architecture

### New Store: `useGitOpsStore`

Independent from `useGitGraphStore`. Manages the Git operations panel state.

```typescript
interface GitOpsState {
  // Panel UI
  isPanelOpen: boolean;

  // Repo overview (fetched on panel open, refreshed after operations)
  repoOverview: GitRepoOverview | null;
  isOverviewLoading: boolean;

  // Branch list (fetched on panel open, searchable)
  branches: GitBranchSummary[];
  searchQuery: string;
  isBranchesLoading: boolean;

  // Switch operation state
  isSwitching: boolean;
  switchError: string | null;

  // Actions
  fetchOverview: (projectPath: string) => Promise<void>;
  openPanel: (projectPath: string) => void;
  closePanel: () => void;
  searchBranches: (projectPath: string, query: string) => void;
  switchBranch: (projectPath: string, branch: GitBranchSummary) => Promise<void>;
}
```

**Key behaviors:**

- `fetchOverview` fetches repo overview without opening the panel. Called on `CommitGraphPanel` mount and after branch operations.
- `openPanel` refreshes overview + fetches branches in parallel, sets `isPanelOpen = true`
- `closePanel` sets `isPanelOpen = false`, clears search and errors
- `searchBranches` debounces internally (300ms), only sends request if query actually changed
- `switchBranch` reads cached `repoOverview` to determine clean/dirty state, then:
  - Clean → calls backend with `stash_if_dirty: false`
  - Dirty (no conflicts) → calls backend with `stash_if_dirty: true` and user's stash message
  - Conflicts → sets error, no backend call
  - On success → refreshes overview + branches, then triggers commit graph refresh via `useGitGraphStore.getState().loadCommits()`
  - On error → sets `switchError`

**Cross-store communication:** After a successful switch, `useGitOpsStore.switchBranch()` calls `useGitGraphStore.getState().loadCommits(projectPath, '')` to refresh the commit graph. This is the standard Zustand pattern for store-to-store calls — no event bus or context needed.

**Stale response protection:** Each async action stores the request's `projectPath` and ignores responses that don't match the current `projectPath`. No cancellation tokens needed at this scope.

### New Component: `GitOpsPanel`

A single component that manages the floating panel with internal state for different phases:

```
States:
  IDLE        → branch list with search
  SWITCHING   → branch list with loading indicator on the target branch
  CONFIRM     → stash confirmation (replaces branch list content)
  ERROR       → error banner shown within the panel
```

**Structure:**

```
GitOpsPanel (overlay + backdrop)
├── Search input (always visible)
├── Content area (switches between states)
│   ├── Branch list (IDLE / SWITCHING)
│   ├── Stash confirmation form (CONFIRM)
│   └── Error message (ERROR)
└── Keyboard: ESC closes, ↑↓ navigates, Enter selects
```

**No separate sub-components.** The panel is ~150-200 lines. The stash confirmation is a state of the same component, not a separate file. Keeps the scope tight and avoids over-abstraction.

### Trigger: Branch Button in CommitGraphPanel

A single button added to the top of `CommitGraphPanel`:

```
[⎇ dev ↑2 ↓0]                     [Refresh]
```

- Shows current branch name (from `useGitOpsStore.repoOverview`)
- Shows ahead/behind counts if upstream exists
- Status chips: "Staged", "Modified", "Untracked", "Conflicts N" when applicable
- Click opens `GitOpsPanel`
- Uses `useGitOpsStore` selectors, not `useGitGraphStore`

**Repo overview loading:** Fetched on `CommitGraphPanel` mount via a separate `useEffect` calling `useGitOpsStore.getState().fetchOverview(projectRoot)`. This runs alongside the existing `loadCommits` call, keeping the two stores decoupled — `useGitGraphStore` doesn't know about `useGitOpsStore`. The cost is negligible (one `git status` call), and the branch button needs this data to be useful. When the panel opens, `openPanel` refreshes the overview and fetches the branch list in parallel.

---

## Interaction Flows

### Flow 1: Clean Switch

```
User clicks branch button
  → Panel opens, overview + branches fetched
  → User sees branch list, searches if desired
  → User clicks "feature/ui-redesign"
  → Frontend reads repoOverview: clean worktree
  → Calls switch_branch(stash_if_dirty: false)
  → Backend: checkout directly
  → Frontend: refresh overview + branches + commits
  → Panel closes
```

### Flow 2: Dirty Switch (Stash & Switch)

```
User clicks branch button
  → Panel opens, overview shows "3 modified" badge
  → User clicks "feature/ui-redesign"
  → Frontend reads repoOverview: dirty worktree (no conflicts)
  → Panel transitions to CONFIRM state
  → Shows: "3 uncommitted changes — Stash and switch?"
  → Optional stash message input (pre-filled: "WIP: on <current-branch>")
  → User clicks "Stash & Switch"
  → Calls switch_branch(stash_if_dirty: true, stash_message: "WIP: on dev")
  → Backend: stash → checkout
  → Frontend: refresh overview + branches + commits
  → Panel closes
```

### Flow 3: Conflicts

```
User clicks branch button
  → Overview shows "2 conflicts" badge
  → User clicks any branch
  → Frontend reads repoOverview: has conflicts
  → Error shown inline: "Resolve conflicts before switching branches"
  → No backend call made
```

### Flow 4: Remote Branch

```
User sees "origin/feature/ui" in remote section
  → Clicks it
  → Same clean/dirty check as above
  → Backend: create local tracking branch → checkout
  → Result includes current_branch = "feature/ui" (without origin/ prefix)
```

---

## Keyboard Navigation

- `ESC` — close panel (from any state)
- `↑` / `↓` — navigate branch list
- `Enter` — select focused branch
- `Tab` — in CONFIRM state, move between stash message input and buttons

Focus is trapped within the panel while open.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Worktree dirty, user didn't stash | Show stash confirmation |
| Conflicts exist | Block with error message, no backend call |
| Branch not found | Show error, refresh branch list |
| Stash fails | Show error from backend, don't switch |
| Checkout fails (e.g., would overwrite) | Show error from backend, stash was created but not popped |
| Backend returns DirtyWorktree despite frontend thinking clean | Show error, refresh overview (race condition) |

---

## Extension Points

The panel is designed to support future Git operations without structural changes:

1. **Stash management** — Add a "Stashes" tab or section to the panel, with pop/apply/drop actions
2. **Create branch** — Add a "New Branch" option at the top of the branch list, with name input
3. **Commit** — Add a "Commit" action that shows a message input + staged files summary
4. **Merge/Rebase** — Add as context actions on branches (right-click or action buttons)
5. **Git log** — The panel could switch to a "recent operations" view showing reflog entries

The `useGitOpsStore` will grow new actions, and `GitOpsPanel` will gain new content states, but the architecture (floating panel, overlay, separate store) remains the same.

---

## File Changes Summary

### New Files (4)
| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src-tauri/crates/git/src/branch.rs` | ~250 | Branch commands + helpers |
| `src/store/useGitOpsStore.ts` | ~180 | Git operations state management |
| `src/components/features/patch/GitOpsPanel.tsx` | ~200 | Floating panel component |
| `src-tauri/crates/git/permissions/autogenerated/commands/*.toml` | auto-gen | Permission configs |

### Modified Files (5)
| File | Change |
|------|--------|
| `src-tauri/crates/git/src/lib.rs` | Register 3 new commands |
| `src-tauri/crates/git/src/models.rs` | Add 4 new structs |
| `src-tauri/crates/git/src/error.rs` | Add 4 error variants |
| `src-tauri/crates/git/build.rs` | Add 3 command names |
| `src/components/features/patch/CommitGraphPanel.tsx` | Add branch button (~20 lines) |
| `src/components/features/patch/patch_types.ts` | Add 3 new interfaces |

### Test Files (1)
| File | Content |
|------|---------|
| `src-tauri/crates/workspace-tests/tests/centralized_git_commands.rs` | Add ~3 tests: overview, branch listing+switch, dirty worktree blocking |
