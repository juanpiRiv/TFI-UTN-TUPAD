import http from "node:http";

// supertest abre un servidor efímero por cada pedido. Desde Node 19 el agente global mantiene los sockets
// abiertos (keep-alive): si un servidor ya cerrado y uno nuevo toman el mismo puerto, el agente reusa un
// socket muerto y el pedido falla con "socket hang up". Sin keep-alive cada pedido abre su propia conexión.
http.globalAgent = new http.Agent({ keepAlive: false });
