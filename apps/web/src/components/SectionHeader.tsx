// Polar's two-column section header: label on the left, two-tone headline and lede on the right.
interface SectionHeaderProps {
  readonly id?: string;
  readonly label: string;
  readonly headline: readonly [string, string];
  readonly lede: string;
}

export function SectionHeader({ id, label, headline, lede }: SectionHeaderProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-12">
      <h2 id={id} className="text-section text-fg">
        {label}
      </h2>
      <div>
        <p className="text-section">
          <span className="block text-fg">{headline[0]}</span>
          <span className="block text-muted">{headline[1]}</span>
        </p>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted md:mt-14 md:text-lede">{lede}</p>
      </div>
    </div>
  );
}
