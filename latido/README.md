# Latido (nombre provisional)

Monitorización de webs y página de estado, en español, para pymes, autónomos y agencias.

## Qué hace este MVP
- Registro y login con email y contraseña.
- Monitores HTTP/HTTPS con palabra clave opcional, cada 30 s a 30 min según el plan.
- Reintento antes de marcar una web como caída, para evitar falsas alarmas.
- Incidencias con inicio, fin y motivo.
- Alertas de caída y recuperación por email (SMTP) y Telegram.
- Aviso 14 días antes de que caduque el certificado SSL.
- Página de estado pública por cliente (`/s/<id>`) con barras de las últimas comprobaciones y uptime de 30 días.
- Límites por plan (Gratis 5 monitores / 5 min, Pro 50 / 1 min, Agencia 200 / 30 s). El cobro con Stripe es la siguiente fase; de momento el plan se cambia a mano en la base de datos.
- Protección para que nadie pueda usar el monitor contra la red interna del servidor (Proxmox, IPs privadas, localhost).

Stack: Node 22, Hono, SQLite (better-sqlite3). Un solo contenedor, sin dependencias externas.

## Desarrollo
```bash
npm install
npm test
npm start   # http://localhost:3000
```

## Despliegue en el Proxmox de OVH
1. Crea un LXC Debian 12 (1 vCPU, 1 GB RAM, 8 GB disco basta para empezar) con `nesting=1` e instala Docker.
2. Copia esta carpeta al LXC, crea `.env` a partir de `.env.example` y rellena `BASE_URL`, SMTP y Telegram.
3. Arranca:
   ```bash
   docker compose --profile tunnel up -d --build
   ```
4. En Cloudflare Zero Trust crea un túnel, apunta el dominio a `http://latido:3000` y pon el token en `CLOUDFLARE_TUNNEL_TOKEN`.
5. Copias de seguridad: basta con guardar `data/latido.db` (por ejemplo, con Proxmox Backup o un `sqlite3 .backup` diario).

Para dar plan Pro a un usuario a mano:
```bash
docker compose exec latido node -e "const D=require('better-sqlite3');new D('/data/latido.db').prepare(\"UPDATE users SET plan='pro' WHERE email=?\").run('cliente@ejemplo.es')"
```

## Siguientes pasos
- Pagos con Stripe (Checkout + portal del cliente + webhooks).
- Sonda externa en un segundo VPS para confirmar caídas desde otra red.
- Dominio propio en la página de estado (plan Pro) y marca blanca (Agencia).
- Informes mensuales en PDF para agencias.
- Recuperar contraseña por email, verificación de email y textos legales.
- Herramientas gratuitas para SEO: "¿Está caída [web]?", comprobador SSL.
