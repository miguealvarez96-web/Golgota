import PrivacyRequestsManager from "@/components/privacidad/privacy-requests-manager";
import { getPrivacyManagementAccess } from "@/lib/privacidad/access";
import { loadManagementPrivacyRequests } from "@/lib/privacidad/data";

export default async function PrivacyRequestsPage() {
  const access = await getPrivacyManagementAccess();
  if (!access) return <Notice text="No tienes permiso para revisar solicitudes de privacidad." />;

  const result = await loadManagementPrivacyRequests(access);
  if (!result.data) return <Notice text={result.error ?? "No fue posible cargar las solicitudes."} />;

  return <main className="portal-page">
    <div>
      <p className="eyebrow">Protección de datos</p>
      <h1 className="page-title mt-2">Solicitudes de privacidad</h1>
      <p className="mt-2 max-w-3xl text-sm text-brand-secondary">
        Bandeja de revisión para admin y owner. Cada cambio queda asociado al revisor; ninguna solicitud elimina datos automáticamente.
      </p>
    </div>
    <div className="mt-7"><PrivacyRequestsManager requests={result.data} /></div>
  </main>;
}

function Notice({ text }: { text: string }) {
  return <main className="portal-page">
    <h1 className="page-title">Solicitudes de privacidad</h1>
    <div role="alert" className="panel mt-6 p-6">{text}</div>
  </main>;
}
