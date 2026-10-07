# SmartQueue — Client Frontend

Vite + React 18 frontend for SmartQueue with plain CSS, role-based routing, authenticated Socket.io real-time connection, and single-flight coalescing.

---

## Architecture & File Structure

```
client/
├── src/
│   ├── auth/
│   │   └── AuthContext.jsx         # Session state in localStorage (token, user, role)
│   ├── components/
│   │   ├── ProtectedRoute.jsx      # Role guards: redirects unauthenticated & wrong roles
│   │   └── TokenCard.jsx           # Renders 7 token statuses, ARIA accessibility, cancel & join-again
│   ├── lib/
│   │   ├── api.js                  # Fetch wrapper adding Bearer token, ApiError, 401 redirect
│   │   ├── errors.js               # Error code dictionary mapping codes to friendly messages
│   │   └── coalescedRunner.js      # Single-flight runner preventing concurrent dashboard fetches
│   ├── pages/
│   │   ├── Login.jsx               # 2-step phone & OTP verification with demo hints
│   │   ├── PatientHome.jsx         # Mobile-first screen: available services, active tokens, resync
│   │   └── StaffDashboard.jsx      # Desktop dashboard: counter picker, call-next, patient actions
│   ├── realtime/
│   │   └── SocketProvider.jsx      # Single socket connection with reconnection states & event subscriptions
│   ├── App.jsx                     # Route definitions (/login, /patient, /staff)
│   ├── index.css                   # Responsive plain CSS design system (tap targets >= 48px)
│   └── main.jsx                    # Application entry wrapped in React.StrictMode
```

---

## Dependencies & Rationale

| Dependency | Category | Rationale |
| :--- | :--- | :--- |
| `react` & `react-dom` | Production | Modern UI rendering and component state management. |
| `react-router-dom` | Production | Client-side routing between `/login`, `/patient`, and `/staff` with role guards. |
| `socket.io-client` | Production | WebSocket client maintaining authenticated real-time connection with automatic reconnects. |
| `vite` | Dev | Fast local bundler with instant HMR and optimized production builds. |
| `@vitejs/plugin-react` | Dev | React JSX transform support in Vite. |
| `vitest` | Dev | Native Vite test runner for fast component and unit tests. |
| `@testing-library/react` | Dev | User-centric DOM testing for React components. |
| `@testing-library/jest-dom` | Dev | DOM matchers (`toBeInTheDocument`, etc.). |
| `jsdom` | Dev | Browser environment emulation for test runs. |

---

## Automated Client Tests

Run tests with:
```bash
npm test
```

Test coverage includes:
1. `TokenCard.test.jsx`: Renders all 7 token statuses correctly (`waiting`, `called`, `serving`, `completed`, `skipped`, `no_show`, `cancelled`).
2. `coalescedRunner.test.js`: Confirms 10 rapid `run()` calls while `fn` is slow make `fn` run exactly twice, never concurrently.
3. `errors.test.js`: Confirms friendly message mapping for `QUEUE_EMPTY`, `COUNTER_BUSY`, `ALREADY_IN_QUEUE`, `INVALID_TRANSITION`, `INVALID_OTP`, and default fallbacks.
4. `routeGuards.test.jsx`: Verifies patients are redirected away from `/staff` and staff away from `/patient`.
