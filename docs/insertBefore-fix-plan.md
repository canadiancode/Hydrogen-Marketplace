# Plan: Fix "insertBefore" DOM Error Across the Site

**Error:** `Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.`

**Scope:** All routes (78 route files). Root layout, PageLayout, WornVaultHeader, creator/admin layouts, and any route or component that can cause hydration mismatch or DOM structure changes during navigation.

**Goal:** Eliminate structural layout switches, hydration mismatches, and portal/navigation race conditions so React's DOM reconciliation never hits a stale or moved node.

---

## Phase 1: Root Layout Stability (Critical)

**Problem:** In `app/root.jsx`, when `useRouteLoaderData('root')` is undefined, the app renders only `<Outlet />`. When data exists, it renders the full tree (Analytics, PageLayout with header/main/footer, Outlet). That **layout switch** is a primary cause of the insertBefore error during client-side navigation or hydration.

**Files:** `app/root.jsx`

### 1.1 Remove the "no data" layout switch

- **Current:** `if (!data) return <Outlet />;`
- **Target:** Never render a different top-level structure based on `data`. Always render the same shell so the DOM shape is stable.
- **Options (pick one):**
  - **A (recommended):** Always render `PageLayout` + `Outlet`. Pass `data` when present; when absent, pass placeholders (e.g. `header` from a minimal/default, `cart: null`, `footer: null`, `isLoggedIn: false`, `isCreator: false`) so PageLayout can show a consistent skeleton (e.g. header placeholder + main + footer placeholder) without awaiting root loader. Resolve real data inside PageLayout via Suspense/Await so only _content_ changes, not the presence of header/main/footer nodes.
  - **B:** Ensure root loader always returns at least a minimal payload on client navigations (e.g. from cache or a sync value) so `data` is never undefined after first load. Then replace `if (!data) return <Outlet />` with a loading UI that keeps the same layout (e.g. same header + main with spinner + footer).
- **Verification:** Navigate between `/`, `/for-buyers`, `/for-creators`, and other routes multiple times; root should never swap between "Outlet only" and "full PageLayout" tree.

### 1.2 Document root loader contract

- In `root.jsx` or a short comment, state that the root loader must return enough to render the shell (or that the shell is always rendered with placeholders). This prevents future "early return Outlet" patterns.

---

## Phase 2: PageLayout Header Slot Stability

**Problem:** In `app/components/PageLayout.jsx`, the header is wrapped in `Suspense` + nested `Await` with multiple `errorElement` branches that each render `<WornVaultHeader>`. When promises resolve, React swaps from fallback/error tree to the real header. That swap can coincide with route changes and cause insertBefore.

**Files:** `app/components/PageLayout.jsx`

### 2.1 Single, stable header node

- **Current:** Suspense fallback → Await(isLoggedIn) errorElement/success → Await(isCreator) errorElement/success → WornVaultHeader. Multiple possible trees.
- **Target:** One persistent header node (e.g. always render `<header>` or a single wrapper). Only the _inner_ content (auth state, cart) should depend on async data.
- **Implementation:**
  - Always render one wrapper, e.g. `<div className="h-16" data-header-slot>` or `<header role="banner">` that never unmounts.
  - Resolve `isLoggedIn` and `isCreator` in a small wrapper component that uses Suspense + Await and renders `WornVaultHeader` (or a header skeleton) _inside_ that slot. So the slot is always there; only its children change.
  - Alternatively: resolve isLoggedIn/isCreator at a higher level (e.g. in root or a tiny provider) and pass resolved/loading state into a single `WornVaultHeader` so it never gets replaced, only updated via props.

### 2.2 Avoid conditional header presence when hideHeaderFooter toggles

- `hideHeaderFooter` is driven by `useMatches()` (creator, admin routes). When navigating from a public route to `/creator/*` or `/admin/*`, the header and footer disappear in one update. That's a big DOM change; ensure it doesn't happen in the same commit as outlet content change if possible (e.g. same layout shell with header hidden via CSS or a stable placeholder when hidden). Optional hardening; lower priority than 2.1.

---

## Phase 3: Hydration-Safe Client-Only State

**Problem:** Any `useState` or initial render that differs between server and client can cause hydration mismatch. React then patches the DOM and may hit insertBefore when the tree is complex.

**Files to audit and fix:**

### 3.1 `app/routes/for-buyers.jsx` — useSystemTheme

- **Current:** `useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)` with SSR guard returning `false`. Server renders light; client may render dark → mismatch.
- **Fix:**
  - Use a single initial value for both environments, e.g. `useState(false)`.
  - In `useEffect`, call `matchMedia('(prefers-color-scheme: dark)')` and `setIsDark(matches)` (and subscribe to changes). First paint matches server; theme updates after hydration.
- **Usage:** Ensure any conditional output (e.g. image `src` for light/dark) uses the post-effect value only for updates, or use CSS `prefers-color-scheme` / `dark:` for initial styling so no JS-dependent DOM difference on first paint.

### 3.2 Global audit: `window` / `matchMedia` in initial state

- **Pattern to search:** `useState(() => { ... window ... })`, `useState(typeof window !== 'undefined' ? ... : ...)`, and any `matchMedia` in initial state.
- **Files already identified:** `app/routes/for-buyers.jsx` (useSystemTheme). Check `app/hooks/useAnimatedClipPath.js` (matchMedia for reduced motion) and any other hooks used during first paint.
- **Rule:** No `window` or `matchMedia` in initial state. Use a safe default (e.g. `false`) and set real value in `useEffect`.

### 3.3 Other route-level checks

- `app/routes/listings.$id.jsx`, `app/routes/creators.$handle.jsx`: `shareUrl = typeof window !== 'undefined' ? window.location.href : ''` — ensure this is not used to render different structure on first paint (e.g. only use in event handlers or after mount).
- `app/routes/creator.social-links.jsx`: Multiple `typeof window !== 'undefined'` — ensure they don't change initial DOM structure or critical attributes.

---

## Phase 4: Headless UI Dialog / Portal and Navigation

**Problem:** Headless UI's `Dialog` (and similar components) often render into a portal (e.g. `#headlessui-portal-root`). If the user navigates (e.g. clicks a link) while a dialog is open or closing, React updates the route tree while the portal DOM is being updated, and insertBefore can occur.

**Components using Dialog (default portal):**

- `app/components/WornVaultHeader.jsx` — mobile menu (no `portal={false}`).
- `app/components/creator/CreatorNavigation.jsx` — mobile sidebar.
- `app/components/SearchModal.jsx` — search modal.
- `app/components/CartDrawer.jsx` — cart drawer.
- `app/components/MakeOfferModal.jsx` — make offer modal.

### 4.1 WornVaultHeader mobile menu (high impact)

- **Option A:** Add `portal={false}` to the mobile `Dialog` in WornVaultHeader. Keep the panel inside the header DOM tree. Adjust z-index/positioning so it still overlays correctly. Then no portal node is moved during route updates.
- **Option B:** Keep portal; ensure the menu is closed before navigation. On every nav link in the mobile menu, call the menu close handler and then navigate (e.g. `onClick={() => { setMobileMenuOpen(false); /* then navigate via Link or useNavigate */ }}`). Optionally delay navigation by one frame so the portal can unmount first.

### 4.2 CreatorNavigation mobile sidebar

- Same as 4.1: either `portal={false}` or close-before-navigate for links inside the sidebar.

### 4.3 SearchModal, CartDrawer, MakeOfferModal

- Lower frequency during navigation (user often closes before navigating). If errors persist after 4.1–4.2, apply the same pattern: close before route change, or use `portal={false}` where layout allows.

### 4.4 Cross-cutting: close overlays on route change

- In layout or router, on location change (e.g. `useEffect` on `location.pathname`), close any global overlays (mobile menu, search, cart, creator sidebar) so no dialog is open when the new route commits. WornVaultHeader already closes mobile menu on pathname change; ensure CreatorNavigation and any global modal state do the same.

---

## Phase 5: Creator Route Layout Consistency

**Problem:** In `app/routes/creator.jsx`, when `location.pathname === '/creator/login'` the component returns only `<Outlet />`. Otherwise it returns `<CreatorLayout><Outlet /></CreatorLayout>`. That's another layout switch that can contribute to insertBefore when navigating to/from `/creator/login`.

**Files:** `app/routes/creator.jsx`

### 5.1 Stable creator shell

- **Option A:** Always render `CreatorLayout` and let the login page opt out of sidebar/nav visually (e.g. via a prop or route handle like `hideCreatorNav: true`). CreatorLayout always wraps Outlet; login page just renders full-width content inside it.
- **Option B:** Keep conditional layout but ensure login is the only route that doesn't use CreatorLayout, and add a short comment that this is intentional. Prefer closing any open Dialog in CreatorLayout (or in creator route) before navigating to/from login so no portal is open during the layout switch.

---

## Phase 6: Scripts, ScrollRestoration, and Links

**Current state:** Root uses a stable `links()` with literal hrefs and renders `{children}` then `ScrollRestoration` then `Scripts`. This is already in line with Hydrogen's insertBefore workaround (styles in links, consistent order).

### 6.1 No structural change

- Keep body order as: `children` → `ScrollRestoration` → `Scripts`. Don't conditionally render or reorder these.

### 6.2 Optional: ensure headlessui portal root exists

- If Headless UI creates a portal root on first use, ensure it's created in a stable place (e.g. document.body). Avoid removing or moving the portal container during navigation. Default behavior is usually fine; only revisit if errors persist after Phases 1–5.

---

## Phase 7: Testing and Verification

### 7.1 Routes to test repeatedly

- **Public:** `/`, `/for-buyers`, `/for-creators`, `/shop`, `/contact`, `/creators`, `/creator/login`, a product page, a listing page.
- **Account:** `/account`, `/account/orders` (if applicable).
- **Creator:** `/creator/login`, `/creator/dashboard`, `/creator/listings`, `/creator/settings` (navigate from header and from creator sidebar).
- **Admin:** `/admin`, `/admin/listings` (after auth).

### 7.2 Scenarios

- Navigate: click "For Buyers", "For Creators", "Shop", "Creator login", then back. Repeat 10–20 times.
- Navigate with mobile menu open: open hamburger menu, click "For Buyers" or "For Creators", confirm no insertBefore.
- Navigate with creator sidebar open (mobile): open creator sidebar, click a nav item, confirm no insertBefore.
- Hydration: do a full reload on `/for-buyers` and `/for-creators` (including with dark mode preference) and confirm no console errors.
- Fast clicks: rapid navigation between two routes; confirm no insertBefore.

### 7.3 Error boundary

- Existing root ErrorBoundary already detects insertBefore and suggests refresh. Keep it. Optionally add a one-time `window.onerror` or error boundary log (in dev) that captures the stack trace when the message includes "insertBefore" to confirm which phase fixed the issue if it reappears.

---

## Phase 8: Documentation and Guardrails

### 8.1 Inline comments

- In `root.jsx`: brief comment that the root layout must never switch between two different top-level structures (Outlet-only vs full layout).
- In `PageLayout.jsx`: comment that the header slot must remain a single stable node; only inner content may be async.

### 8.2 Lint or review rules (optional)

- Consider a simple rule or PR checklist: no `useState` initializers that use `window` or `matchMedia`; no conditional return of entirely different layout trees in root or layout routes.

---

## Implementation Order

| Priority | Phase                                                      | Rationale                                                    |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| 1        | Phase 1 (Root layout)                                      | Removes the most likely cause of insertBefore on navigation. |
| 2        | Phase 2 (PageLayout header)                                | Stabilizes the second major DOM structure change.            |
| 3        | Phase 3 (for-buyers + audit)                               | Removes hydration mismatch on high-traffic pages.            |
| 4        | Phase 4.1–4.2 (WornVaultHeader + CreatorNavigation Dialog) | Removes portal/navigation races.                             |
| 5        | Phase 5 (Creator route)                                    | Avoids extra layout switch to/from login.                    |
| 6        | Phase 4.3, 6, 7, 8                                         | Hardening, testing, docs.                                    |

---

## Route and Component Reference

**Layout routes:** `app/root.jsx`, `app/routes/creator.jsx`, `app/routes/admin.jsx`, `app/routes/account.jsx`.

**Routes with hideHeaderFooter:** `creator.jsx` (true), `admin.jsx` (true), `creator.login.jsx` (false override).

**Components with Dialog/portal:** WornVaultHeader, CreatorNavigation, SearchModal, CartDrawer, MakeOfferModal.

**Routes with client-only state to audit:** for-buyers.jsx (useSystemTheme), creator.social-links.jsx, listings.$id.jsx, creators.$handle.jsx, useAnimatedClipPath.js.

**Total route files:** 78; focus layout and shared components first, then high-traffic and theme-dependent routes.
