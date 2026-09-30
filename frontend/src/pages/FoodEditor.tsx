import { useLocation, useNavigate, useParams } from "react-router";
import { ErrorState, Spinner } from "../components/EmptyState";
import { CustomFoodForm } from "../forms/CustomFoodForm";
import { useMyFoods, useSaveCustomFood } from "../lib/queries";
import type { Food } from "../lib/types";

/** /nutrition/foods/new (optionally prefilled from a database food) and /nutrition/foods/:id */
export function FoodEditor() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const save = useSaveCustomFood();
  const foods = useMyFoods();
  const prefill = (location.state as { prefill?: Food } | null)?.prefill;

  const done = () => void navigate("/nutrition/foods");

  if (id) {
    if (foods.isPending) return <Spinner />;
    if (foods.isError) return <ErrorState message={foods.error.message} />;
    const food = foods.data.find((f) => f.id === id);
    if (!food) return <ErrorState message="That food doesn't exist anymore." />;
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Edit food</h1>
        <CustomFoodForm
          initial={food}
          editing
          onSubmit={async (body) => {
            await save.mutateAsync({ id, body });
            done();
          }}
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{prefill ? "Copy to my foods" : "New food"}</h1>
      <CustomFoodForm
        initial={prefill}
        onSubmit={async (body) => {
          await save.mutateAsync({ body });
          done();
        }}
      />
    </section>
  );
}
