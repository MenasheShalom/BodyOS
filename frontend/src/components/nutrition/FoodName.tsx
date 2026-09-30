/** Food names can be Hebrew or English: dir="auto" gets the character order right, while
 * text-left keeps them lined up with the rest of the (left-to-right) list. */
export function FoodName({ name, brand }: { name: string; brand?: string | null }) {
  return (
    <span className="min-w-0">
      <span dir="auto" className="block truncate text-left">
        {name}
      </span>
      {brand && (
        <span dir="auto" className="block truncate text-left text-xs text-muted">
          {brand}
        </span>
      )}
    </span>
  );
}
