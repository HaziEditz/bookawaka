import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  required?: boolean;
  className?: string;
  inputClassName?: string;
};

/**
 * datetime-local with an explicit in-app Done/Confirm so mobile users are not
 * stuck relying on OS chrome to dismiss the picker.
 */
export function NzDateTimeInput({
  id,
  name,
  value,
  onChange,
  min,
  required,
  className,
  inputClassName,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const confirm = () => {
    inputRef.current?.blur();
    setFocused(false);
  };

  return (
    <div className={cn("flex gap-2 items-stretch", className)}>
      <Input
        ref={inputRef}
        id={id}
        name={name}
        type="datetime-local"
        value={value}
        min={min}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Delay so Done click can run before focus clears.
          window.setTimeout(() => setFocused(false), 150);
        }}
        className={cn("rounded-xl h-11 flex-1", inputClassName)}
      />
      <Button
        type="button"
        variant={focused || value ? "default" : "outline"}
        onClick={confirm}
        className="rounded-xl h-11 px-4 font-bold shrink-0"
        aria-label="Confirm date and time"
      >
        <Check className="w-4 h-4 mr-1.5" />
        Done
      </Button>
    </div>
  );
}
