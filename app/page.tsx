import ModelViewer from "@/components/ModelViewer";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f4f6f8] px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
        <header className="max-w-3xl">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            Lokalna prezentacja modeli 3D
          </p>
          <h1 className="text-4xl font-bold tracking-normal text-slate-950 sm:text-5xl">3D Serwis</h1>
          <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">
            Interaktywny podglad modelu przed i po naprawie. Obracaj obiekt, porownaj warianty i sprawdz
            podstawowy raport jakosci modelu.
          </p>
        </header>

        <section className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <ModelViewer
            damagedModelUrl="/models/damaged.glb"
            fixedModelUrl="/models/fixed.glb"
            showDebug={process.env.NODE_ENV === "development"}
          />
        </section>
      </section>
    </main>
  );
}
