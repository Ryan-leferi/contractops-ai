import { z } from "zod";

export const idSchema = z.string().min(1);
export type Id = z.infer<typeof idSchema>;

export const isoDateTimeSchema = z.string().datetime();
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
