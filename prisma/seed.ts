import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding initial Admin user...')

  const adminEmail = 'admin@guardiao.com'
  const adminPassword = 'admin'

  const existingAdmin = await prisma.admin.findUnique({
    where: { email: adminEmail }
  })

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10)

    await prisma.admin.create({
      data: {
        name: 'Administrador Master',
        email: adminEmail,
        passwordHash: hashedPassword,
        role: 'ADMIN'
      }
    })
    console.log('Admin user created!')
    console.log(`Email: ${adminEmail}`)
    console.log(`Password: ${adminPassword}`)
  } else {
    console.log('Admin user already exists.')
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
