
import React, { useEffect, useState } from "react";

export default function App() {
  const [status, setStatus] = useState("Checking application...");
  const [products, setProducts] = useState([]);

  useEffect(() => {
    async function check() {
      try {
        if (!window.store) {
          setStatus("Electron database bridge is unavailable.");
          return;
        }

        const result = await window.store.products();

        setProducts(result);
        setStatus("Database connected successfully!");
      } catch (error) {
        setStatus("Database error: " + error.message);
      }
    }

    check();
  }, []);

  return (
    <div style={{ padding: 40, fontFamily: "Arial" }}>
      <h1>Kirana Manager</h1>
      <h3>{status}</h3>
      <p>Products registered: {products.length}</p>
    </div>
  );
}

