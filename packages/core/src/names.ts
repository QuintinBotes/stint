const MODEL_NAMES: Record<string, string> = {
  'muse-wonder-1.0': 'Muse Wonder 1.0',
  'muse-spark-1.3': 'Muse Spark 1.3',
  'muse-spark-1.2': 'Muse Spark 1.2',
  'muse-spark-open': 'Muse Spark Open',
  'muse-glimmer:30b-mlx': 'Muse Glimmer 30B',
};

/** A model's display name, the same in the web UI and the CLI; an id it does not know is shown as it is. */
export function modelName(model: string | null | undefined): string {
  if (!model) return 'model unknown';
  const short = model.includes('/') ? (model.split('/').at(-1) as string) : model;
  return MODEL_NAMES[short] ?? short;
}
