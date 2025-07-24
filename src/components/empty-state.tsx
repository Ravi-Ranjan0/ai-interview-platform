import { AlertCircle } from "lucide-react";
import Image from "next/image";


interface Props{
    title: string;
    description: string;
};

export const EmptyState  = ({ title, description }:Props) => {
    return (
        <div className="flex flex-col items-center justify-center">
                <img src="https://cdn3d.iconscout.com/3d/premium/thumb/location-not-found-3d-illustration-download-in-png-blend-fbx-gltf-file-formats--world-logo-finding-error-empty-state-pack-seo-web-illustrations-4468818.png?f=webp" alt="Empty State" className="size-6 w-[240px] h-[240px]" />
                <div className="flex flex-col gap-y-6 max-w-md mx-auto text-center">
                    <h6 className="text-lg font-medium">{title}</h6>
                    <p className="text-sm text-muted-foreground">{description}</p>
                </div>
        </div>
    );
};