import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class joiner, used by the assistant-ui elements in components/assistant-ui. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
