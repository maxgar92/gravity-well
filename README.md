# Gravity Well · versión táctil

Versión para celular de **Gravity Well 3.5**, el juego de conquista planetaria para Windows de Software Engineering, Inc. (1995). Corre en el navegador: se puede jugar solo contra la computadora u online con amigos, sin instalar nada ni crear cuentas.

**Jugar:** https://maxgar92.github.io/gravity-well/

## Jugar online con amigos

1. Abrí el juego, tocá **Jugar online**, poné tu nombre y tocá **Crear partida**.
2. Tocá **Invitar por WhatsApp** (o **Copiar enlace**) y mandales el enlace.
3. Cada amigo abre el enlace en el navegador del celular, pone su nombre y toca **Unirme**.
4. En la sala elegí el equipo de cada color (Equipo A, Equipo B o sin equipo, también para los colores que maneja la computadora) y tocá **Empezar partida**.

Detalles a tener en cuenta:

- Quien crea la partida hace de anfitrión: su teléfono corre la partida, así que tiene que quedar con el juego en pantalla. Si lo bloquea o cambia de app, la partida se pausa para todos.
- Hasta 4 jugadores. Los colores libres los maneja la computadora.
- Si alguien se desconecta, la computadora maneja su color hasta que vuelva a entrar con el mismo enlace desde el mismo teléfono.
- Si Chrome cierra el juego del anfitrión al cambiar de app (por ejemplo, al mandar la invitación por WhatsApp), al volver a abrirlo la sala o la partida se recupera sola con el mismo código, y los amigos reconectan solos.
- Los aliados no se dañan, comparten el radar y pueden repararse en la base del otro. Gana el último equipo en pie.

## Cómo está hecho

- `index.html` es el juego completo en un solo archivo. Se arma con `python3 tools/build.py` a partir de `src/` y `vendor/`.
- `src/sim.js` tiene la física, la economía y la inteligencia de los rivales; `src/net.js`, el juego online.
- Online: el anfitrión simula la partida y manda el estado unas 12 veces por segundo. Cada jugador simula su propia nave en su teléfono (para que responda al instante) y le reporta posición e intenciones al anfitrión. La conexión es directa entre teléfonos (WebRTC, con [PeerJS](https://github.com/peers/peerjs)); el servicio público de PeerJS solo presenta a los teléfonos y hace de relevo cuando la red no permite la conexión directa.
- Pruebas: `node tools/simtest.js` (partidas entre computadoras), `node tools/mechtest.js` (aterrizaje, acople, equipos, protocolo online), `tools/mptest.js` (tres celulares emulados con Playwright y un servidor PeerJS local, `tools/peerserver.js`) y `tools/mptest2.js` (recuperación cuando se cierra la pestaña del anfitrión).

## Créditos

Gravity Well © 1995 Software Engineering, Inc., distribuido originalmente como shareware. Esta versión usa las formas vectoriales (`SYMBOLS.DAT`) y los sonidos del juego original, y sigue las reglas de su manual.

PeerJS se incluye bajo licencia MIT (ver `vendor/LICENSE-peerjs.txt`).
