import { useId } from "react";
import { Input } from "@/components/ui/input";
import { PY_CITIES, cityOptionLabel, findPyCity } from "@/lib/py-cities";

/**
 * Campo de ciudad con listado para buscar y elegir.
 * Al elegir una ciudad conocida, avisa también su departamento.
 * Se puede escribir una ciudad que no esté en la lista.
 */
export function CityPicker({
  value,
  onChange,
  placeholder = "Buscá o elegí la ciudad",
}: {
  value: string;
  onChange: (city: string, department: string | null) => void;
  placeholder?: string;
}) {
  const listId = useId();
  return (
    <>
      <Input
        list={listId}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          const match = findPyCity(e.target.value);
          if (match) onChange(match.city, match.department);
          else onChange(e.target.value, null);
        }}
      />
      <datalist id={listId}>
        {PY_CITIES.map((c) => (
          <option key={`${c.city}-${c.department}`} value={c.city} label={cityOptionLabel(c)}>
            {cityOptionLabel(c)}
          </option>
        ))}
      </datalist>
    </>
  );
}
