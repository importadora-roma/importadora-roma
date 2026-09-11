import type { UserRole } from '@/types/models'

export interface GuideChapter {
  key: string
  roles?: UserRole[]
  importadoraOnly?: boolean
  titleEs: string
  titleTr: string
  bodyEs: string[]
  bodyTr: string[]
}

export const guideChapters: GuideChapter[] = [
  {
    key: 'intro',
    titleEs: 'Introducción',
    titleTr: 'Giriş',
    bodyEs: [
      'Importadora Roma ERP es el sistema donde se registran todas las ventas, el inventario, las cotizaciones, los traslados entre sucursales y los reportes del negocio. Todo lo que hagas aquí queda guardado — no se pierde información.',
      'Hay tres tipos de usuario: Vendedor (solo ve y trabaja en su propia sucursal, registra ventas y cotizaciones), Supervisor (además puede gestionar inventario, caja, créditos, facturas y ver reportes de su sucursal) y Admin (ve y administra todas las sucursales, usuarios, contraseñas y configuración del sistema).',
      'Cada sucursal ve solo sus propios datos — una sucursal nunca ve las ventas ni la caja de otra sucursal, salvo el Admin, que ve todas.',
      'Si tu usuario es Admin, en la parte superior derecha puedes cambiar entre sucursales con el selector de sucursal. Los demás roles trabajan siempre en su propia sucursal, sin ese selector.',
      'Para cambiar tu propia contraseña en cualquier momento, usa el botón "Cambiar contraseña" en el menú lateral izquierdo.',
    ],
    bodyTr: [
      'Importadora Roma ERP, tüm satışların, envanterin, fiyat tekliflerinin, şubeler arası transferlerin ve iş raporlarının kaydedildiği sistemdir. Burada yaptığınız her şey kalıcı olarak saklanır — hiçbir veri kaybolmaz.',
      'Üç tür kullanıcı vardır: Vendedor/Satış Elemanı (sadece kendi şubesini görür ve çalışır, satış ve teklif kaydeder), Supervisor/Sorumlu (ayrıca envanter, kasa, kredi, fatura yönetebilir ve kendi şubesinin raporlarını görebilir) ve Admin/Yönetici (tüm şubeleri, kullanıcıları, şifreleri ve sistem ayarlarını görür ve yönetir).',
      'Her şube sadece kendi verilerini görür — bir şube asla başka bir şubenin satışlarını veya kasasını göremez; buna tek istisna, tüm şubeleri görebilen Admin\'dir.',
      'Eğer hesabınız Admin ise, ekranın sağ üstünde şubeler arasında geçiş yapabileceğiniz bir seçici bulunur. Diğer roller her zaman kendi şubelerinde çalışır, bu seçiciyi görmezler.',
      'Şifrenizi istediğiniz zaman değiştirmek için sol menüdeki "Cambiar contraseña" (Şifre değiştir) butonunu kullanabilirsiniz.',
    ],
  },
  {
    key: 'panel',
    titleEs: 'Panel',
    titleTr: 'Panel (Ana Sayfa)',
    bodyEs: [
      'Es la primera pantalla al entrar. Muestra un resumen del día: total vendido hoy, estado de la caja (abierta o cerrada), productos sin stock, facturas pendientes y — si tu sucursal recibe contenedores — contenedores en conteo.',
      'También verás un gráfico de "Ventas por método de pago" (efectivo, tarjeta, transferencia y traslados a otras sucursales), que puedes cambiar entre Hoy / Últimos 7 días / Este mes.',
      'El botón negro "Nueva venta" lleva directo a registrar una venta.',
    ],
    bodyTr: [
      'Sisteme girince ilk açılan ekrandır. Günün özetini gösterir: bugün yapılan toplam satış, kasa durumu (açık/kapalı), stoğu biten ürünler, bekleyen faturalar ve — şubeniz konteyner alıyorsa — sayımdaki konteynerler.',
      'Ayrıca "Ödeme yöntemine göre satışlar" grafiğini görürsünüz (nakit, kart, transfer ve diğer şubelere gönderilen mallar) — Bugün / Son 7 gün / Bu ay arasında geçiş yapabilirsiniz.',
      'Siyah "Nueva venta" (Yeni satış) butonu direkt satış ekranına götürür.',
    ],
  },
  {
    key: 'ventas',
    importadoraOnly: true,
    titleEs: 'Ventas',
    titleTr: 'Satışlar',
    bodyEs: [
      'Para registrar una venta: busca el producto por nombre o código (o escanéalo con la cámara), ajusta cantidad y precio si es necesario, selecciona un cliente si aplica, y registra el pago — puede ser en un solo método o dividido entre efectivo, tarjeta, transferencia y crédito.',
      'Si el pago incluye crédito, es obligatorio elegir un cliente (para poder cobrarle después).',
      'Solo Admin y Supervisor ven el campo "Fecha de la venta": permite registrar una venta que en realidad ocurrió otro día (por ejemplo, una venta olvidada de la semana pasada), para que aparezca correctamente en los reportes de esa fecha. Si el pago fue en efectivo, ese dinero no se suma a la caja de hoy, porque ese dinero no está entrando hoy.',
      'En el Historial puedes ver todas las ventas, abrir el detalle, anular una venta (Admin/Supervisor), cambiar un producto, o imprimir/enviar el comprobante por WhatsApp o correo.',
    ],
    bodyTr: [
      'Satış kaydetmek için: ürünü isim veya koddan arayın (ya da kamerayla tarayın), gerekiyorsa miktar/fiyatı düzenleyin, varsa müşteri seçin, ve ödemeyi kaydedin — tek yöntemle ya da nakit/kart/transfer/kredi arasında bölerek.',
      'Ödemede kredi varsa, mutlaka bir müşteri seçilmesi zorunludur (sonradan tahsilat yapabilmek için).',
      'Sadece Admin ve Supervisor "Fecha de la venta" (Satış tarihi) alanını görür: bu, gerçekte başka bir günde olmuş bir satışı (örneğin geçen hafta unutulan bir satışı) doğru tarihte kaydetmenizi sağlar, böylece raporlarda doğru güne/aya sayılır. Eğer ödeme nakitse, bu para bugünün kasasına eklenmez, çünkü o para fiziksel olarak bugün girmiyor.',
      'Geçmiş (Historial) sekmesinde tüm satışları görebilir, detayını açabilir, satışı iptal edebilir (Admin/Supervisor), bir ürünü değiştirebilir veya fişi yazdırıp WhatsApp/e-posta ile gönderebilirsiniz.',
    ],
  },
  {
    key: 'cotizaciones',
    importadoraOnly: true,
    titleEs: 'Cotizaciones',
    titleTr: 'Fiyat Teklifleri (Cotizaciones)',
    bodyEs: [
      'Una cotización es un presupuesto para el cliente, sin que sea todavía una venta. Se arma igual que una venta (productos, cantidades, precios) pero sin registrar pago.',
      'Puedes ponerle una fecha de vencimiento y notas. Al imprimirla o enviarla, sale con el logo y los datos de la sucursal.',
      'Cuando el cliente confirma, se abre la cotización y se usa el botón "Convertir en venta" — ahí sí se piden los pagos, y se convierte en una venta real.',
      'Si en la cotización agregaste un cliente rápido (botón "+"), ahora se pueden llenar todos sus datos: RUT, dirección, correo y notas — igual que en la sección Clientes.',
    ],
    bodyTr: [
      'Cotización, müşteri için henüz satışa dönüşmemiş bir fiyat teklifidir. Bir satış gibi hazırlanır (ürünler, miktarlar, fiyatlar) ama ödeme kaydedilmez.',
      'Son geçerlilik tarihi ve not ekleyebilirsiniz. Yazdırıldığında veya gönderildiğinde logo ve şube bilgileriyle çıkar.',
      'Müşteri onayladığında, teklifi açıp "Convertir en venta" (Satışa dönüştür) butonunu kullanırsınız — o an ödeme bilgileri istenir ve gerçek bir satışa dönüşür.',
      'Teklif ekranında hızlı müşteri ekleme ("+" butonu) artık tüm bilgileri almanıza izin veriyor: RUT, adres, e-posta ve not — Clientes bölümündeki gibi.',
    ],
  },
  {
    key: 'clientes',
    titleEs: 'Clientes',
    titleTr: 'Müşteriler',
    bodyEs: [
      'Aquí se guardan todos los clientes con su nombre, RUT, teléfono, correo, dirección y notas. Los clientes se comparten entre todas las sucursales — no hay que crear el mismo cliente dos veces.',
      'Puedes crear un cliente nuevo, editar sus datos o desactivarlo si ya no corresponde.',
    ],
    bodyTr: [
      'Burada tüm müşteriler; isim, RUT, telefon, e-posta, adres ve notlarıyla saklanır. Müşteriler tüm şubeler arasında ortaktır — aynı müşteriyi iki kez oluşturmaya gerek yoktur.',
      'Yeni müşteri oluşturabilir, bilgilerini düzenleyebilir veya artık geçerli değilse pasif hale getirebilirsiniz.',
    ],
  },
  {
    key: 'inventario',
    roles: ['admin', 'supervisor'],
    titleEs: 'Inventario',
    titleTr: 'Envanter (Stok)',
    bodyEs: [
      'Muestra el stock de cada producto en tu sucursal (o en todas, si eres Admin y eliges "Todas las sucursales"). Desde aquí se agregan productos nuevos, se ajusta el stock manualmente (con motivo obligatorio) y se editan precios y costos.',
      'El botón "Agregar producto" crea un producto nuevo o, si ya existe con la misma calidad y kilo, suma el stock a esa variante existente — no duplica productos.',
    ],
    bodyTr: [
      'Şubenizdeki (Admin iseniz ve "Tüm şubeler" seçtiyseniz tüm şubelerdeki) her ürünün stoğunu gösterir. Buradan yeni ürün eklenir, stok elle düzeltilir (sebep belirtmek zorunludur) ve fiyat/maliyetler düzenlenir.',
      '"Agregar producto" (Ürün ekle) butonu yeni bir ürün oluşturur; aynı kalite ve kilo ile zaten varsa, o mevcut varyanta stok ekler — ürünü tekrar oluşturmaz.',
    ],
  },
  {
    key: 'kardex',
    roles: ['admin', 'supervisor'],
    titleEs: 'Kardex',
    titleTr: 'Kardex (Stok Hareket Geçmişi)',
    bodyEs: [
      'Es el historial de todos los movimientos de stock: ventas, ajustes manuales, traslados recibidos y enviados, contenedores recibidos. Sirve para investigar por qué el stock de un producto cambió.',
    ],
    bodyTr: [
      'Tüm stok hareketlerinin geçmişidir: satışlar, elle yapılan düzeltmeler, gelen/giden transferler, alınan konteynerler. Bir ürünün stoğunun neden değiştiğini araştırmak için kullanılır.',
    ],
  },
  {
    key: 'transferencias',
    roles: ['admin', 'supervisor'],
    titleEs: 'Transferencias',
    titleTr: 'Şubeler Arası Transferler',
    bodyEs: [
      'Permite enviar fardos desde tu sucursal a otra. Se elige el destino, los productos y cantidades, y queda como "En tránsito" hasta que la sucursal destino confirma la recepción con "Marcar como recibido".',
      'Un traslado no cuenta como venta — el dinero de un traslado a otra sucursal se ve por separado en los reportes.',
    ],
    bodyTr: [
      'Kendi şubenizden başka bir şubeye fardo göndermenizi sağlar. Hedef şube, ürünler ve miktarlar seçilir; hedef şube "Marcar como recibido" (Alındı olarak işaretle) diyene kadar "En tránsito" (Yolda) durumunda kalır.',
      'Bir transfer satış sayılmaz — başka bir şubeye giden malın değeri raporlarda ayrı gösterilir.',
    ],
  },
  {
    key: 'contenedores',
    importadoraOnly: true,
    titleEs: 'Contenedores',
    titleTr: 'Konteynerler',
    bodyEs: [
      'Módulo para recibir un contenedor completo (cientos de fardos) y comparar, fardo por fardo, lo que llega físicamente contra la lista del proveedor.',
      'Nueva recepción: se crea el contenedor y se importa la lista esperada (Excel). Conteo activo: se escanean o cuentan los fardos a medida que se descargan, y se ve en tiempo real cuánto falta, cuánto sobra o si aparece un código desconocido. Historial: contenedores ya completados. Códigos desconocidos: fardos escaneados que no estaban en la lista, para resolverlos (agregarlos, ignorarlos, etc.).',
    ],
    bodyTr: [
      'Tam bir konteyneri (yüzlerce fardo) almak ve fiziksel olarak geleni tedarikçinin listesiyle fardo fardo karşılaştırmak için modüldür.',
      'Nueva recepción (Yeni alım): konteyner oluşturulur ve beklenen liste (Excel) içe aktarılır. Conteo activo (Aktif sayım): fardolar indirilirken taranır/sayılır, ne kadar eksik/fazla olduğu veya bilinmeyen bir kod çıkıp çıkmadığı anlık görülür. Historial (Geçmiş): tamamlanmış konteynerler. Códigos desconocidos (Bilinmeyen kodlar): listede olmayan, taranmış fardolar — bunları çözmek için (listeye eklemek, yok saymak vb.).',
    ],
  },
  {
    key: 'caja',
    roles: ['admin', 'supervisor'],
    importadoraOnly: true,
    titleEs: 'Caja',
    titleTr: 'Kasa',
    bodyEs: [
      'Al empezar el día se "Abre caja" indicando el monto inicial en efectivo. Cada venta en efectivo se suma automáticamente. También se pueden registrar ingresos o retiros manuales (con categoría y descripción).',
      'Al terminar el día se "Cierra caja": el sistema muestra cuánto efectivo debería haber ("esperado") y tú ingresas cuánto hay en realidad — así se detecta cualquier diferencia.',
    ],
    bodyTr: [
      'Gün başında "Abre caja" (Kasa aç) ile başlangıç nakit tutarı girilir. Her nakit satış otomatik olarak eklenir. Ayrıca elle giriş/çıkış da kaydedilebilir (kategori ve açıklamayla).',
      'Gün sonunda "Cierra caja" (Kasa kapat) yapılır: sistem ne kadar nakit olması gerektiğini ("esperado") gösterir, siz de gerçekte ne kadar olduğunu girersiniz — böylece herhangi bir fark hemen fark edilir.',
    ],
  },
  {
    key: 'creditos',
    roles: ['admin', 'supervisor'],
    importadoraOnly: true,
    titleEs: 'Créditos',
    titleTr: 'Krediler (Veresiye)',
    bodyEs: [
      'Lista todas las ventas con saldo de crédito pendiente de cobro. Se puede registrar un abono (pago parcial o total), cambiar la fecha de vencimiento, o enviar un recordatorio por WhatsApp al cliente.',
    ],
    bodyTr: [
      'Tahsilat bekleyen kredi (veresiye) bakiyesi olan tüm satışları listeler. Kısmi veya tam ödeme kaydedebilir, vade tarihini değiştirebilir veya müşteriye WhatsApp ile hatırlatma gönderebilirsiniz.',
    ],
  },
  {
    key: 'facturas',
    roles: ['admin', 'supervisor'],
    importadoraOnly: true,
    titleEs: 'Facturas',
    titleTr: 'Faturalar',
    bodyEs: [
      'Lista las ventas marcadas como "requiere factura". El sistema calcula automáticamente el neto y el IVA para que los ingreses en el SII (este sistema no emite facturas electrónicas reales, solo organiza cuáles faltan por facturar).',
      'Una vez emitida la factura en el SII, se marca como "Emitida" aquí, indicando el folio real si se desea.',
    ],
    bodyTr: [
      '"Fatura gerekli" olarak işaretlenmiş satışları listeler. Sistem, SII\'ye (Şili vergi dairesi) girmeniz için net tutar ve KDV\'yi otomatik hesaplar (bu sistem gerçek e-fatura kesmez, sadece hangilerinin faturalanması gerektiğini takip eder).',
      'Fatura SII\'de kesildikten sonra, isterseniz gerçek folio numarasını belirterek burada "Emitida" (Kesildi) olarak işaretlenir.',
    ],
  },
  {
    key: 'reportes',
    roles: ['admin', 'supervisor'],
    titleEs: 'Reportes',
    titleTr: 'Raporlar',
    bodyEs: [
      'Muestra ventas totales, por método de pago, costo, margen, gastos, utilidad neta y traslados, para el período y sucursal que elijas. Incluye un gráfico de ventas por día y el detalle de ventas por producto.',
      'El botón "Exportar PDF" genera un reporte mensual con el logo, nombre y dirección de la sucursal — listo para imprimir o archivar.',
    ],
    bodyTr: [
      'Seçtiğiniz dönem ve şube için toplam satış, ödeme yöntemine göre dağılım, maliyet, kâr marjı, giderler, net kâr ve transferleri gösterir. Günlük satış grafiği ve ürün bazlı satış detayını içerir.',
      '"Exportar PDF" (PDF olarak dışa aktar) butonu, logo ile şube adı ve adresini içeren aylık bir rapor oluşturur — yazdırmaya veya arşivlemeye hazır.',
    ],
  },
  {
    key: 'rentabilidad',
    roles: ['admin', 'supervisor'],
    titleEs: 'Rentabilidad',
    titleTr: 'Karlılık',
    bodyEs: [
      'Aquí se registran los gastos (sueldos, arriendo, servicios, otros) con su fecha, y opcionalmente se marca si salieron de la caja en efectivo. También hay una herramienta para recalcular el costo de ventas antiguas que quedaron con costo $0.',
    ],
    bodyTr: [
      'Burada giderler (maaş, kira, hizmetler, diğer) tarihiyle kaydedilir ve isteğe bağlı olarak nakit kasadan çıkıp çıkmadığı işaretlenir. Ayrıca maliyeti $0 kalmış eski satışların maliyetini yeniden hesaplamak için bir araç bulunur.',
    ],
  },
  {
    key: 'auditoria',
    roles: ['admin'],
    titleEs: 'Auditoría',
    titleTr: 'Denetim (Auditoría)',
    bodyEs: [
      'Registro de todos los cambios sensibles del sistema: anulaciones de venta, cambios de precio, cambios de rol, creación de usuarios y cambios de contraseña (sin mostrar la contraseña nunca). Solo Admin puede verlo. Sirve para saber quién hizo qué y cuándo.',
    ],
    bodyTr: [
      'Sistemdeki tüm hassas değişikliklerin kaydıdır: satış iptalleri, fiyat değişiklikleri, rol değişiklikleri, kullanıcı oluşturma ve şifre değişiklikleri (şifrenin kendisi asla gösterilmez). Sadece Admin görebilir. Kimin ne zaman ne yaptığını takip etmek içindir.',
    ],
  },
  {
    key: 'configuracion',
    roles: ['admin'],
    titleEs: 'Configuración',
    titleTr: 'Ayarlar (Configuración)',
    bodyEs: [
      'Sucursales: crear y editar sucursales (nombre, dirección, tipo). Usuarios: crear cuentas nuevas (nombre, correo, contraseña, rol, sucursal), cambiar el rol o sucursal de alguien, y resetear la contraseña de cualquier usuario con el ícono de llave — ya no es necesario entrar a Supabase.',
      'Contenedores: configuración del módulo de recepción (idioma, umbrales). Alertas: qué avisos automáticos recibe cada sucursal (stock bajo, créditos vencidos, etc.). Costos por calidad: precios de costo por defecto según la calidad del producto.',
    ],
    bodyTr: [
      'Sucursales (Şubeler): şube oluşturma ve düzenleme (isim, adres, tür). Usuarios (Kullanıcılar): yeni hesap oluşturma (isim, e-posta, şifre, rol, şube), birinin rolünü/şubesini değiştirme, ve anahtar ikonuyla herhangi bir kullanıcının şifresini sıfırlama — artık Supabase\'e girmeye gerek yok.',
      'Contenedores (Konteynerler): alım modülünün ayarları (dil, eşikler). Alertas (Uyarılar): her şubenin hangi otomatik uyarıları alacağı (düşük stok, vadesi geçmiş krediler vb.). Costos por calidad (Kaliteye göre maliyet): ürün kalitesine göre varsayılan maliyet fiyatları.',
    ],
  },
  {
    key: 'roles_resumen',
    titleEs: 'Resumen de roles y permisos',
    titleTr: 'Rol ve yetki özeti',
    bodyEs: [
      'Vendedor: Panel, Ventas, Cotizaciones, Clientes y Contenedores (solo su sucursal, sin fecha retroactiva en ventas).',
      'Supervisor: todo lo del Vendedor, más Inventario, Kardex, Transferencias, Caja, Créditos, Facturas, Reportes y Rentabilidad (solo su sucursal), y puede registrar ventas con fecha retroactiva.',
      'Admin: todo lo anterior en todas las sucursales, más Auditoría y Configuración (incluyendo crear usuarios y cambiar cualquier contraseña).',
      'Cualquier usuario, sin importar su rol, puede cambiar su propia contraseña desde el botón "Cambiar contraseña" del menú lateral.',
    ],
    bodyTr: [
      'Vendedor: Panel, Ventas (Satışlar), Cotizaciones (Teklifler), Clientes (Müşteriler) ve Contenedores (Konteynerler) — sadece kendi şubesi, satışlarda geçmiş tarih girme yetkisi yok.',
      'Supervisor: Vendedor\'ün tüm yetkileri, artı Inventario (Envanter), Kardex, Transferencias (Transferler), Caja (Kasa), Créditos (Krediler), Facturas (Faturalar), Reportes (Raporlar) ve Rentabilidad (Karlılık) — sadece kendi şubesi, ve geçmiş tarihli satış kaydedebilir.',
      'Admin: yukarıdakilerin hepsi, tüm şubelerde, artı Auditoría (Denetim) ve Configuración (Ayarlar) — kullanıcı oluşturma ve herhangi bir şifreyi değiştirme dahil.',
      'Rolü ne olursa olsun her kullanıcı, sol menüdeki "Cambiar contraseña" butonundan kendi şifresini değiştirebilir.',
    ],
  },
]

export function getVisibleChapters(role: UserRole, isTienda: boolean): GuideChapter[] {
  return guideChapters.filter((c) => (!c.roles || c.roles.includes(role)) && (!c.importadoraOnly || !isTienda))
}
