"use client";

import { useEffect, useState } from "react";

export default function MergePage() {
  const [families, setFamilies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalItems: 0, totalFamilies: 0 });

  async function fetchItems() {
    setLoading(true);
    const res = await fetch("/api/gmail/items");
    const data = await res.json();
    
    const fetchedFamilies = data.families || [];
    setFamilies(fetchedFamilies);

    // Stats berechnen
    let itemCount = 0;
    fetchedFamilies.forEach((f: any) => {
        f.subgroups.forEach((s: any) => itemCount += s.items.length);
    });

    setStats({
      totalItems: itemCount,
      totalFamilies: fetchedFamilies.length
    });
    setLoading(false);
  }

  useEffect(() => {
    fetchItems();
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Inventory Merger</h1>
          <p className="text-gray-500 mt-1">Hierarchische Ansicht: Familien (ca. 80%) &gt; Varianten (100%)</p>
        </div>
        <div className="text-right text-sm text-gray-400">
          {stats.totalItems} Items in {stats.totalFamilies} Familien
        </div>
      </div>

      <div className="space-y-8">
        {families.map((family, fIndex) => (
          <div key={fIndex} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            
            {/* Header der Familie (Das "Dach") */}
            <div className="bg-blue-50/50 px-6 py-4 border-b border-blue-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <div className="bg-blue-100 text-blue-600 p-2 rounded-lg">
                    📦
                 </div>
                 <div>
                    <h2 className="font-bold text-gray-800 text-lg">{family.familyName}</h2>
                    <span className="text-xs text-blue-500 font-medium">Produkt-Familie</span>
                 </div>
              </div>
              <span className="bg-white border border-gray-200 text-gray-500 text-xs px-3 py-1 rounded-full">
                {family.subgroups.length} Varianten
              </span>
            </div>

            {/* Die Untergruppen (Varianten) */}
            <div className="p-4 space-y-4">
               {family.subgroups.map((subgroup: any, sIndex: number) => (
                 <div key={sIndex} className="pl-4 border-l-4 border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-gray-300"></span>
                        Variante: "{subgroup.name}" 
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            subgroup.similarity === 100 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                            {subgroup.similarity}% Match
                        </span>
                        <span className="text-gray-400 font-normal">({subgroup.items.length})</span>
                    </h3>
                    
                    {/* Tabelle der Items in dieser Variante */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-gray-500">
                            <thead className="bg-gray-50 uppercase">
                                <tr>
                                    <th className="px-3 py-2">Originaler Name aus E-Mail</th>
                                    <th className="px-3 py-2">Shop</th>
                                    <th className="px-3 py-2">Preis</th>
                                    <th className="px-3 py-2">Datum</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {subgroup.items.map((item: any) => (
                                    <tr key={item.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 text-gray-900 font-medium">{item.name}</td>
                                        <td className="px-3 py-2">{item.shop || "-"}</td>
                                        <td className="px-3 py-2 font-mono">{item.price} {item.currency}</td>
                                        <td className="px-3 py-2">{new Date(item.buyDate).toLocaleDateString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                 </div>
               ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
