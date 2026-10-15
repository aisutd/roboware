FROM node:20-alpine

WORKDIR /app

# Copy package definition files
COPY package.json ./

# Install project dependencies
RUN npm install

# Copy project files
COPY . .

# Expose Vite development server port
EXPOSE 5173

# Run development server with host binding
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
