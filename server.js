const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const { calculateDistance } = require('./utils');

const server = http.createServer();
const redis = new Redis();

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['*'],
  },
});

const PORT = process.env.PORT || 3500;

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Drivers Events
  socket.on("updateDriverLocation", async (data) => {
    const { driverId, latitude, longitude } = data;
    const key = `driver:${driverId}:location`;

    console.log("Updating driver location:", { driverId, latitude, longitude, socketId: socket.id });

    // Store driver location in Redis with socketId
    await redis.hset(key, {
      latitude,
      longitude,
      timestamp: Date.now(),
      socketId: socket.id
    });

    await redis.expire(key, 2000);

    // Add driver to the driverRoom
    socket.join('driverRoom');
  });

  // Clients Events
  socket.on("requestRide", async (data) => {
    const { clientId, latitude, longitude, rideRequestId } = data;
    console.log("Ride request received:", data);
    const maxDistance =  10; // Default to 2 km if not provided

    // Find nearby drivers
    const drivers = await redis.keys("driver:*:location");
    const nearbyDrivers = await Promise.all(drivers.map(async (driver) => {
      const driverData = await redis.hgetall(driver);
      const distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        parseFloat(driverData.latitude),
        parseFloat(driverData.longitude)
      );
      return { driver, distance, ...driverData };
    }));

    // Filter and sort nearby drivers
    const sortedNearbyDrivers = nearbyDrivers
      .filter(driver => driver.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance);

    console.log(`Found ${sortedNearbyDrivers.length} nearby drivers for rider ${clientId}`);

    // create a new room for the client with clientId
    const room = `client:${clientId}`;
    socket.join(room);

    sortedNearbyDrivers.forEach((driver) => {
      const driverSocketId = driver.socketId;
      if (io.sockets.sockets.has(driverSocketId)) {
        // join the driver to the room
        io.sockets.sockets.get(driverSocketId).join(room);
    
      } else {
        console.log("Driver socket not found:", driverSocketId);
      }
    });


    // console the room members
    console.log("Room members:", io.sockets.adapter.rooms.get(room));

    // broadcast the ride request to all nearby drivers
    socket.broadcast.to(room).emit("rideRequestFromClient", {
      clientId,
      latitude,
      longitude,
      rideRequestId
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
