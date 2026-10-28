import type { QueryInput } from "../../../packages/contracts/src/index.ts";
export interface SourceFiltersState {
  providerStatus: NonNullable<QueryInput["providerPermitStatus"]> | "any";
  activity: NonNullable<QueryInput["permitActivityClaim"]> | "any";
  issueAge: number;
  deedGap: number;
}
export const initialSourceFilters: SourceFiltersState = {
  providerStatus: "any",
  activity: "any",
  issueAge: 0,
  deedGap: 0,
};
export function SourceFilters({
  value,
  onChange,
}: {
  value: SourceFiltersState;
  onChange: (next: SourceFiltersState) => void;
}) {
  return (
    <>
      <label>
        Provider permit status
        <select
          aria-label="Provider permit status"
          value={value.providerStatus}
          onChange={(e) =>
            onChange({
              ...value,
              providerStatus: e.target
                .value as SourceFiltersState["providerStatus"],
            })
          }
        >
          <option value="any">Any / no source filter</option>
          {[
            "FILED",
            "ISSUED",
            "IN_PROGRESS",
            "FINAL",
            "EXPIRED",
            "CANCELLED",
            "REVOKED",
            "UNKNOWN",
            "INTERCONNECTED",
          ].map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </label>
      <label>
        Permit activity evidence
        <select
          aria-label="Permit activity evidence"
          value={value.activity}
          onChange={(e) =>
            onChange({
              ...value,
              activity: e.target.value as SourceFiltersState["activity"],
            })
          }
        >
          <option value="any">Any / no source filter</option>
          <option value="provider_reported_active">
            Provider reported active
          </option>
          <option value="native_reported_open">
            Independently observed native open
          </option>
          <option value="not_established">Not established</option>
        </select>
      </label>
      <label>
        Minimum age since permit issue (days)
        <input
          type="number"
          min="0"
          max="50000"
          value={value.issueAge}
          onChange={(e) =>
            onChange({ ...value, issueAge: Number(e.target.value) })
          }
        />
        <small>Issue age is separate from continuous open days.</small>
      </label>
      <label>
        No observed recorded-deed gap older than (years)
        <input
          type="number"
          min="0"
          max="200"
          value={value.deedGap}
          onChange={(e) =>
            onChange({ ...value, deedGap: Number(e.target.value) })
          }
        />
        <small>
          Current-PIN official index through its verified cutoff; legal
          ownership continuity is unestablished.
        </small>
      </label>
    </>
  );
}
