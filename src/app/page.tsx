import { instance } from "@config/instance";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">{instance.home.title}</h1>
      <p className="text-lg">{instance.home.message}</p>
    </main>
  );
}
