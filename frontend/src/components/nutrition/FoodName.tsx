/** Food names can be Hebrew or English; dir="auto" lets each render in its own direction. */
export function FoodName({ name, brand }: { name: string; brand?: string | null }) {
  return (
    <span className="min-w-0">
      <span dir="auto" className="block truncate">
        {name}
      </span>
      {brand && (
        <span dir="auto" className="block truncate text-xs text-muted">
          {brand}
        </span>
      )}
    </span>
  );
}
