interface Props {
    children: React.ReactNode;
}

const Layout = ({ children }: Props) => {
    return (
        <div className="h-screen bg-blacks">
            {children}
        </div>
    )
};

export default Layout;
    