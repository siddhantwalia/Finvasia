import { ReactNode } from "react";

interface Props {
  index: string; // e.g. "02"
  kicker: string;
  title: string;
  blurb?: string;
  right?: ReactNode;
}

export const PageHeader = ({ index, kicker, title, blurb, right }: Props) => (
  <section className="border-b border-border">
    <div className="container py-10 md:py-14 grid gap-6 md:grid-cols-[1fr_auto] items-end">
      <div>
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-3">
          <span className="text-primary">{index}</span>
          <span className="h-px w-8 bg-border" />
          <span>{kicker}</span>
        </div>
        <h1 className="font-display text-3xl md:text-5xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {blurb && <p className="mt-3 max-w-2xl text-muted-foreground">{blurb}</p>}
      </div>
      {right}
    </div>
  </section>
);
