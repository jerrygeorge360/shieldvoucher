import React, { useEffect, useState } from 'react';

export const VoucherArt: React.FC = () => {
    const [active, setActive] = useState(true);

    useEffect(() => {
        const timer = setInterval(() => {
            setActive(prev => !prev);
        }, 4000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div style={{ width: '100%', height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <svg width="400" height="200" viewBox="0 0 400 200" style={{ filter: 'drop-shadow(0 0 10px rgba(201,168,76,0.1))' }}>
                {/* Node A */}
                <circle cx="100" cy="100" r="4" fill="var(--muted)" style={{ transition: 'all 1s' }} />
                <text x="80" y="80" className="mono animate-fade-in-up" style={{ fontSize: '10px', fill: 'var(--muted)' }}>0xORIGIN</text>

                {/* Node B */}
                <circle cx="300" cy="100" r="4" fill="var(--fg)" style={{ transition: 'all 1s' }} />
                <text x="280" y="80" className="mono animate-fade-in-up" style={{ fontSize: '10px', fill: 'var(--fg)' }}>0xRECIPIENT</text>

                {/* Connecting Line with severance animation */}
                <path
                    d="M 104 100 L 296 100"
                    stroke={active ? "var(--muted)" : "transparent"}
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    style={{ transition: 'stroke 0.3s ease', opacity: active ? 1 : 0 }}
                />

                {/* The Severance Symbol */}
                <g style={{
                    opacity: active ? 0 : 1,
                    transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                    transform: active ? 'scale(0.8)' : 'scale(1)',
                    transformOrigin: '200px 100px'
                }}>
                    <path
                        d="M 190 70 L 210 130"
                        stroke="var(--accent)"
                        strokeWidth="3"
                        style={{
                            transform: `rotate(${active ? 0 : 25}deg)`,
                            transition: 'transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                            transformOrigin: '200px 100px'
                        }}
                    />
                    <text
                        x="165"
                        y="150"
                        className="mono"
                        style={{
                            fontSize: '10px',
                            fill: 'var(--accent)',
                            fontWeight: 'bold',
                            letterSpacing: '0.1em'
                        }}
                    >
                        LINK_SEVERED
                    </text>
                </g>
            </svg>
        </div>
    );
};
