import { useState } from "react";
import { useNavigate } from "react-router";
import { ProfileForm } from "../forms/ProfileForm";
import { WeighInForm } from "../forms/WeighInForm";
import { bodyEntries, useSaveProfile } from "../lib/queries";

export function Onboarding() {
  const [step, setStep] = useState<"profile" | "weigh-in">("profile");
  const saveProfile = useSaveProfile();
  const createEntry = bodyEntries.useCreate();
  const navigate = useNavigate();

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <p className="text-sm text-muted">Step {step === "profile" ? 1 : 2} of 2</p>
      {step === "profile" ? (
        <>
          <h1 className="mb-6 mt-1 text-2xl font-semibold">A few basics</h1>
          <ProfileForm
            submitLabel="Continue"
            onSubmit={async (profile) => {
              await saveProfile.mutateAsync(profile);
              setStep("weigh-in");
            }}
          />
        </>
      ) : (
        <>
          <h1 className="mb-6 mt-1 text-2xl font-semibold">Log your first weigh-in</h1>
          <WeighInForm
            hiddenMetrics={[]}
            onSubmit={async (payload) => {
              await createEntry.mutateAsync(payload);
              navigate("/", { replace: true });
            }}
          />
          <button
            type="button"
            onClick={() => navigate("/", { replace: true })}
            className="mt-4 w-full text-sm text-muted underline"
          >
            Skip for now
          </button>
        </>
      )}
    </main>
  );
}
