import { Component, type ReactNode } from "react";

interface State {
  failed: boolean;
}

// a render error should leave a readable page, not an empty one.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("fm: render failed", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-5 pt-[20vh]">
        <h1 className="mb-3 font-serif text-4xl text-ink">fm</h1>
        <p className="text-sm text-muted">algo falló al mostrar la página. probá recargar en un rato.</p>
      </div>
    );
  }
}
