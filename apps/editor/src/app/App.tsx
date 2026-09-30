import { lazy, Suspense } from "react";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { config } from "@/lib/env";
import { Toaster } from "@/ui/Toast";
import { TooltipProvider } from "@/ui/Tooltip";
import { HomePage } from "@/features/home/HomePage";
import { LoginPage } from "@/features/auth/LoginPage";
import { DevicePage } from "@/features/auth/DevicePage";
import { ConnectPage } from "@/features/auth/ConnectPage";
import { BrowserGate } from "./BrowserGate";
import { NotFoundPage, RouteError } from "./RouteError";
import { FullScreenLoader } from "./FullScreenLoader";

// The editor is the heavy part (timeline, renderer); load it on demand so the
// projects home opens instantly.
const EditorRoute = lazy(() => import("@/features/editor/EditorRoute"));

function Root() {
  return (
    <TooltipProvider delayDuration={450} skipDelayDuration={250}>
      <Outlet />
      <Toaster />
    </TooltipProvider>
  );
}

const router = createBrowserRouter(
  [
    {
      element: <Root />,
      errorElement: <RouteError />,
      children: [
        { path: "/", element: <HomePage /> },
        {
          path: "/p/:projectId",
          element: (
            <BrowserGate>
              <Suspense fallback={<FullScreenLoader label="Opening editor" />}>
                <EditorRoute />
              </Suspense>
            </BrowserGate>
          ),
        },
        { path: "/login", element: <LoginPage /> },
        { path: "/connect", element: <ConnectPage /> },
        { path: "/device", element: <DevicePage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: config.basename || "/" },
);

export function App() {
  return <RouterProvider router={router} />;
}
