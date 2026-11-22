import type { InstanceConfig } from "@/modules/instance";
import { buttonClass, inputClass, labelClass } from "@/modules/ui";
import { EMBLEM_SYMBOL, TEAM_EMBLEMS, type TeamIdentity } from "../identity";

// Formulário da identidade da equipe (#56). Tudo à vista (ata 17/11 §10); quem pode salvar o banco
// decide (líder da equipe ou coordenação do escopo).
type IdentityFormProps = {
  readonly teamId: string;
  readonly identity: TeamIdentity;
  readonly text: InstanceConfig["teamIdentity"];
  readonly saveAction: (formData: FormData) => Promise<void>;
};

const colorClass = "h-14 w-24 cursor-pointer rounded-xl border-2 border-field bg-surface p-1";

export function IdentityForm({ teamId, identity, text, saveAction }: IdentityFormProps) {
  const [c1 = "#d4a537", c2 = "#0b0d12", c3] = identity.colors;
  return (
    <form action={saveAction} className="flex flex-col gap-5">
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex flex-col gap-1">
        <label htmlFor="motto" className={labelClass}>
          {text.mottoLabel}
        </label>
        <input id="motto" name="motto" type="text" maxLength={80} defaultValue={identity.motto ?? ""} className={inputClass} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className={labelClass}>{text.colorsLegend}</legend>
        <div className="flex flex-wrap gap-5">
          <label className="flex flex-col gap-1 text-lg">
            {text.color1Label}
            <input type="color" name="color1" defaultValue={c1} className={colorClass} />
          </label>
          <label className="flex flex-col gap-1 text-lg">
            {text.color2Label}
            <input type="color" name="color2" defaultValue={c2} className={colorClass} />
          </label>
          <label className="flex flex-col gap-1 text-lg">
            {text.color3Label}
            <input type="color" name="color3" defaultValue={c3 ?? "#f2efe6"} className={colorClass} />
          </label>
        </div>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 text-lg">
          <input type="checkbox" name="useColor3" defaultChecked={Boolean(c3)} className="h-6 w-6" />
          {text.useColor3Label}
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className={labelClass}>{text.emblemLegend}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TEAM_EMBLEMS.map((emblem) => (
            <label key={emblem} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 border-line bg-surface px-3 text-lg has-[:checked]:border-primary">
              <input type="radio" name="emblem" value={emblem} defaultChecked={(identity.emblem ?? "estrela") === emblem} required className="h-6 w-6 shrink-0" />
              <span aria-hidden="true" className="text-2xl">
                {EMBLEM_SYMBOL[emblem]}
              </span>
              {text.emblems[emblem]}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className={buttonClass("primary")}>
        {text.saveButton}
      </button>
    </form>
  );
}
