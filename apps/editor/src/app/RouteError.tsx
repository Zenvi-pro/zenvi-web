import type { ReactNode } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { Button } from "@/ui/Button";
import { ZenviMark } from "@/ui/Logo";

function Frame({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <main className="grid h-full place-items-center bg-canvas px-4">
      <div className="flex max-w-md flex-col items-center text-center">
        <ZenviMark size={28} className="mb-6 text-fg" />
        <h1 className="font-serif text-3xl text-fg">{title}</h1>
        <p className="mt-3 text-md text-fg-subtle">{body}</p>
        <div className="mt-8 flex gap-2">{children}</div>
      </div>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <Frame title="Nothing here" body="This page does not exist. Your projects are one click away.">
      <Link to="/">
        <Button variant="white" size="lg">
          Go to projects
        </Button>
      </Link>
    </Frame>
  );
}

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Something went wrong.";
  return (
    <Frame title="Something broke" body={`${message} Your work is saved in this browser; reloading usually fixes it.`}>
      <Button variant="white" size="lg" onClick={() => window.location.reload()}>
        Reload
      </Button>
      <Button variant="secondary" size="lg" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}`)}>
        Projects
      </Button>
    </Frame>
  );
}
