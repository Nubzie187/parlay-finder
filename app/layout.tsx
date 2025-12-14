export const metadata = {
  title: 'Parlay Finder',
  description: 'Parlay Finder Application',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

