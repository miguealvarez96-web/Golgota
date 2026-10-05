import Brand from "@/components/layout/brand";
import StudentRegistrationForm from "@/components/auth/student-registration-form";

export default function RegistrationPage() {
  return <main className="min-h-screen bg-brand-bg px-4 py-7 text-brand-text sm:px-8 sm:py-10">
    <div className="mx-auto max-w-3xl">
      <Brand subtitle="Registro de alumnos" />
      <section className="panel mt-7 p-5 sm:p-8 lg:p-10">
        <p className="eyebrow">Portal del alumno</p>
        <h1 className="page-title mt-2">Crea tu cuenta</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-secondary">Registra tus datos para acceder al portal. La cuenta no crea una membresía ni registra pagos.</p>
        <StudentRegistrationForm />
      </section>
    </div>
  </main>;
}
