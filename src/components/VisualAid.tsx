import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, PieChart, Pie, Cell 
} from 'recharts';

interface VisualAidProps {
  type: 'function' | 'geometry' | 'data';
  data?: any;
  config?: any;
}

export default function VisualAid({ type, data, config }: VisualAidProps) {
  if (type === 'function') {
    // data is expected to be an array of { x, y }
    return (
      <div className="h-64 w-full bg-white/50 rounded-xl p-4 my-4 border border-[#5A5A40]/10">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#5A5A4020" />
            <XAxis dataKey="x" stroke="#5A5A4080" fontSize={12} />
            <YAxis stroke="#5A5A4080" fontSize={12} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #5A5A4020' }}
              itemStyle={{ color: '#5A5A40' }}
            />
            <Line type="monotone" dataKey="y" stroke="#5A5A40" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {config?.label && <p className="text-center text-xs mt-2 italic text-[#5A5A40]/60">{config.label}</p>}
      </div>
    );
  }

  if (type === 'geometry') {
    // config expected to have svg content or parameters for a simple shape
    return (
      <div className="flex flex-col items-center justify-center bg-white/50 rounded-xl p-4 my-4 border border-[#5A5A40]/10">
        <svg 
          viewBox={config?.viewBox || "0 0 200 200"} 
          className="w-48 h-48"
          dangerouslySetInnerHTML={{ __html: config?.svgContent }}
        />
        {config?.label && <p className="text-center text-xs mt-2 italic text-[#5A5A40]/60">{config.label}</p>}
      </div>
    );
  }

  if (type === 'data') {
    return (
      <div className="h-64 w-full bg-white/50 rounded-xl p-4 my-4 border border-[#5A5A40]/10">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#5A5A4020" />
            <XAxis dataKey="name" stroke="#5A5A4080" fontSize={12} />
            <YAxis stroke="#5A5A4080" fontSize={12} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #5A5A4020' }}
              itemStyle={{ color: '#5A5A40' }}
            />
            <Bar dataKey="value" fill="#5A5A40" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        {config?.label && <p className="text-center text-xs mt-2 italic text-[#5A5A40]/60">{config.label}</p>}
      </div>
    );
  }

  return null;
}
